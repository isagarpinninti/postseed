import {
  TEMPLATES, generate, prepare, previewEvents, renderText, writeCsv, PostseedError, tableKey,
  type Database, type ExistingData, type GenEvent, type GenerateOptions,
} from "@postseed/core";
import {
  ConnectionError, InsertError, addHistory, connect, deleteConnection, describeConnection, estimateRows, getConnection, insertEvents,
  introspect, isLocalHost, listConnections, listHistory, loadExisting, looksLikeProduction, redactText, redactUrl, saveConnection,
  touchConnection, truncateImpact, type Client, type ConnectionInfo, type HistoryEntry,
} from "@postseed/pg";
import { Zip, ZipDeflate } from "fflate";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { guard, SECURITY_HEADERS, type GuardState } from "./security";
import { BadRequest, ConfirmTokens, parseSettings, toOptions, type Settings } from "./settings";
import { serveStatic } from "./static";

export interface AppDeps {
  guard: GuardState;
  assetsDir?: string;
  version: string;
}

interface Session {
  url: string;
  schema: string;
  name: string;
  connectionId?: string;
  info: ConnectionInfo;
  db: Database;
  estimates: Record<string, number>;
}

const PREVIEW_ROWS = 200;
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

const sseData = (v: unknown): string => JSON.stringify(v);

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const tokens = new ConfirmTokens();
  const startedAt = Date.now();
  let session: Session | undefined;
  let busy = false;

  app.use("*", guard(deps.guard));
  app.use("*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!c.res.headers.has(k)) c.res.headers.set(k, v);
    if (new URL(c.req.url).pathname.startsWith("/api/")) c.res.headers.set("cache-control", "no-store");
  });

  app.onError((err, c) => {
    const body = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ error: { code, message: redactText(message), ...extra } });
    if (err instanceof BadRequest) return c.json(body(err.code, err.message), err.status);
    if (err instanceof ConnectionError) return c.json(body(`CONNECTION_${err.code}`, err.message, { hint: err.hint }), 400);
    if (err instanceof PostseedError) return c.json(body(err.code, err.message), 422);
    if (err instanceof InsertError) return c.json(body("INSERT_FAILED", err.message, { details: err.details }), 409);
    return c.json(body("INTERNAL", err instanceof Error ? err.message : String(err)), 500);
  });

  const need = (): Session => {
    if (!session) throw new BadRequest("Connect to a database first.", "NOT_CONNECTED", 409);
    return session;
  };
  const binding = (s: Session): string => `${s.url}|${s.schema}|${s.info.database}`;
  const withClient = async <T>(fn: (client: Client) => Promise<T>): Promise<T> => {
    const client = await connect(need().url);
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  };
  const summary = (s: Session) => ({
    id: s.connectionId ?? null,
    name: s.name,
    database: s.info.database,
    user: s.info.user,
    host: s.info.host,
    serverVersion: s.info.serverVersion,
    redactedUrl: redactUrl(s.url),
    schema: s.schema,
    isLocal: isLocalHost(s.url),
    looksProduction: looksLikeProduction(s.url, s.info.database),
  });
  const schemaPayload = (s: Session) => ({ db: s.db, estimates: s.estimates });

  /* ───────── health, templates ───────── */
  app.get("/api/health", (c) => c.json({ ok: true, version: deps.version, uptimeMs: Date.now() - startedAt }));
  app.get("/api/templates", (c) => c.json({ templates: TEMPLATES }));

  /* ───────── connections ───────── */
  app.get("/api/connections", async (c) => {
    const all = await listConnections();
    return c.json({ connections: all.map((x) => ({ id: x.id, name: x.name, redactedUrl: redactUrl(x.url), schema: x.schema, lastUsedAt: x.lastUsedAt })) });
  });
  app.post("/api/connections", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { name?: unknown; url?: unknown; schema?: unknown } | null;
    if (!b || typeof b.url !== "string") throw new BadRequest('"url" is required.');
    const saved = await saveConnection({ name: typeof b.name === "string" ? b.name : "Untitled", url: b.url, schema: typeof b.schema === "string" ? b.schema : "public" });
    return c.json({ id: saved.id, name: saved.name, redactedUrl: redactUrl(saved.url), schema: saved.schema });
  });
  app.delete("/api/connections/:id", async (c) => {
    await deleteConnection(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/connect", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { connectionId?: unknown; url?: unknown; schema?: unknown; save?: unknown; name?: unknown } | null;
    if (!b) throw new BadRequest("Expected a JSON body.");
    let url = typeof b.url === "string" ? b.url.trim() : "";
    let schema = typeof b.schema === "string" && b.schema.trim() ? b.schema.trim() : "public";
    let connectionId: string | undefined;
    let name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : "";
    if (typeof b.connectionId === "string") {
      const saved = await getConnection(b.connectionId);
      if (!saved) throw new BadRequest("That saved connection no longer exists.", "NOT_FOUND", 404);
      url = saved.url;
      schema = saved.schema;
      connectionId = saved.id;
      name = saved.name;
    }
    if (!url) throw new BadRequest("Enter a connection string.");
    const client = await connect(url);
    try {
      const info = await describeConnection(client, url);
      const schemas = schema.split(",").map((x) => x.trim()).filter(Boolean);
      const db = await introspect(client, schemas);
      const estimates: Record<string, number> = {};
      for (const e of await estimateRows(client, schemas)) estimates[e.key] = e.rows;
      if (b.save === true && !connectionId) {
        const saved = await saveConnection({ name: name || info.database, url, schema });
        connectionId = saved.id;
        name = saved.name;
      } else if (connectionId) await touchConnection(connectionId);
      session = { url, schema, name: name || info.database, ...(connectionId ? { connectionId } : {}), info, db, estimates };
    } finally {
      await client.end().catch(() => undefined);
    }
    const s = need();
    return c.json({ connection: summary(s), ...schemaPayload(s) });
  });
  app.post("/api/disconnect", (c) => {
    session = undefined;
    return c.json({ ok: true });
  });
  app.get("/api/session", (c) => (session ? c.json({ connection: summary(session), ...schemaPayload(session) }) : c.json({ connection: null })));
  app.post("/api/refresh", async (c) => {
    const s = need();
    await withClient(async (client) => {
      const schemas = s.schema.split(",").map((x) => x.trim());
      s.db = await introspect(client, schemas);
      s.estimates = {};
      for (const e of await estimateRows(client, schemas)) s.estimates[e.key] = e.rows;
    });
    return c.json({ connection: summary(s), ...schemaPayload(s) });
  });

  /* ───────── plan, preview ───────── */
  const prepared = async (settings: Settings): Promise<{ options: GenerateOptions; selected: string[]; rows: Record<string, number>; warnings: string[]; existing: ExistingData }> => {
    const s = need();
    const base = toOptions(settings);
    const prep = prepare(s.db, base);
    if (prep.errors.length > 0) throw new PostseedError(prep.errors.map((e) => e.message).join("\n"), prep.errors[0]?.code ?? "UNSUPPORTED");
    const existing = await withClient((client) => loadExisting(client, s.db, prep.selected));
    return { options: toOptions(settings, { existing, name: s.info.database }), selected: prep.selected, rows: prep.rows, warnings: prep.warnings, existing };
  };

  app.post("/api/plan", async (c) => {
    const s = need();
    const settings = parseSettings(await c.req.json().catch(() => null));
    const prep = prepare(s.db, toOptions(settings));
    const missingParents: Array<{ table: string; parent: string; columns: string[]; existing: number; capped: boolean }> = [];
    const seen = new Set<string>();
    for (const k of prep.selected) {
      const t = s.db.tables.find((x) => tableKey(x) === k);
      for (const fk of t?.foreignKeys ?? []) {
        const parent = `${fk.refSchema}.${fk.refTable}`;
        if (parent === k || prep.selected.includes(parent) || seen.has(`${k}>${parent}`)) continue;
        seen.add(`${k}>${parent}`);
        const count = await withClient(async (client) => {
          const p = s.db.tables.find((x) => tableKey(x) === parent);
          if (!p) return 0;
          const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (SELECT 1 FROM "${p.schema.replace(/"/g, '""')}"."${p.name.replace(/"/g, '""')}" LIMIT 10001) x`);
          return Number(r.rows[0]?.n ?? 0);
        });
        missingParents.push({ table: k, parent, columns: fk.columns, existing: Math.min(count, 10000), capped: count > 10000 });
      }
    }
    return c.json({
      order: prep.plan.order,
      rows: prep.rows,
      totalRows: prep.selected.reduce((n, k) => n + (prep.rows[k] ?? 0), 0),
      warnings: prep.warnings,
      errors: prep.errors.filter((e) => e.code !== "MISSING_PARENT"),
      missingParents,
      truncateImpact: truncateImpact(s.db, prep.selected),
    });
  });

  app.post("/api/generate", async (c) => {
    const s = need();
    const body = (await c.req.json().catch(() => null)) as { previewRows?: unknown } | null;
    const settings = parseSettings(body);
    const stream = c.req.query("stream") === "1";
    const rawBody = body ?? {};
    const limit = rawBody.previewRows === "all" ? 20_000 : typeof rawBody.previewRows === "number" && rawBody.previewRows >= 1 ? Math.min(20_000, Math.floor(rawBody.previewRows)) : PREVIEW_ROWS;
    const run = async (progress: (info: { table: string; done: number; total: number }) => Promise<void>) => {
      const p = await prepared(settings);
      const started = Date.now();
      const events: GenEvent[] = [];
      let done = 0;
      const gen = generate(s.db, p.options);
      for (;;) {
        const n = gen.next();
        if (n.done) break;
        events.push(n.value);
        if (n.value.type === "table-end") {
          done++;
          await progress({ table: n.value.key, done, total: p.selected.length });
          await tick();
        }
      }
      const total = p.selected.reduce((x, k) => x + (p.rows[k] ?? 0), 0);
      const text = [...renderText(previewEvents(events, limit), settings.format)].join("");
      const shownRows = p.selected.reduce((x, k) => x + Math.min(limit, p.rows[k] ?? 0), 0);
      const estimatedBytes = shownRows > 0 ? Math.round((Buffer.byteLength(text) * total) / shownRows) : Buffer.byteLength(text);
      return {
        text,
        format: settings.format,
        stats: { tables: p.selected.length, rows: total, rowsByTable: p.rows, estimatedBytes, ms: Date.now() - started, seed: settings.seed, previewRows: limit, truncated: p.selected.some((k) => (p.rows[k] ?? 0) > limit) },
        order: p.selected,
        warnings: p.warnings,
        confirmToken: tokens.issue(settings, binding(s)),
      };
    };
    if (!stream) return c.json(await run(async () => undefined));
    return streamSSE(c, async (out) => {
      try {
        const result = await run((info) => out.writeSSE({ event: "progress", data: sseData(info) }));
        await out.writeSSE({ event: "result", data: sseData(result) });
      } catch (e) {
        await out.writeSSE({ event: "error", data: sseData({ code: (e as { code?: string }).code ?? "ERROR", message: redactText(e instanceof Error ? e.message : String(e)) }) });
      }
    });
  });

  /* ───────── download ───────── */
  app.post("/api/download", async (c) => {
    const s = need();
    const settings = parseSettings(await c.req.json().catch(() => null));
    const p = await prepared(settings);
    const total = p.selected.reduce((x, k) => x + (p.rows[k] ?? 0), 0);
    const events = generate(s.db, p.options);
    await addHistory({
      connectionName: s.name,
      connectionUrl: s.url,
      tables: p.selected,
      rows: total,
      seed: settings.seed,
      format: settings.format,
      action: "download",
      settings: { rowsPerTable: settings.rows, nullRatio: settings.nullRatio, ...(Object.keys(settings.tableRows).length ? { tableRows: settings.tableRows } : {}) },
    }).catch(() => undefined);
    const stamp = `seed-${settings.seed}`;
    const encoder = new TextEncoder();
    if (settings.format !== "csv") {
      const it = renderText(events, settings.format)[Symbol.iterator]();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          let size = 0;
          while (size < 64 * 1024) {
            const n = it.next();
            if (n.done) return controller.close();
            const bytes = encoder.encode(n.value);
            size += bytes.length;
            controller.enqueue(bytes);
          }
        },
      });
      return new Response(body, {
        headers: {
          "content-type": settings.format === "sql" ? "application/sql; charset=utf-8" : "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${stamp}.${settings.format}"`,
        },
      });
    }
    const it = writeCsv(events)[Symbol.iterator]();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) return controller.error(err);
          controller.enqueue(chunk);
          if (final) controller.close();
        });
        let file: ZipDeflate | undefined;
        let name = "";
        for (let n = it.next(); !n.done; n = it.next()) {
          if (n.value.file !== name) {
            file?.push(new Uint8Array(0), true);
            name = n.value.file;
            file = new ZipDeflate(name, { level: 6 });
            zip.add(file);
          }
          file?.push(encoder.encode(n.value.text));
        }
        file?.push(new Uint8Array(0), true);
        zip.end();
      },
    });
    return new Response(body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${stamp}.zip"` } });
  });

  /* ───────── insert ───────── */
  app.post("/api/insert", async (c) => {
    const s = need();
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) throw new BadRequest("Expected a JSON body.");
    const settings = parseSettings(raw.settings);
    const truncate = raw.truncate === true;
    const dryRun = raw.dryRun === true;
    if (!tokens.verify(raw.confirmToken, settings, binding(s))) {
      throw new BadRequest("These settings have changed since the preview. Generate again before inserting.", "PREVIEW_REQUIRED", 409);
    }
    if (truncate && raw.confirmDatabase !== s.info.database) {
      throw new BadRequest(`To truncate, type the database name (${s.info.database}).`, "CONFIRM_DATABASE", 403);
    }
    if (busy) throw new BadRequest("Another insert is already running.", "BUSY", 409);
    busy = true;
    return streamSSE(c, async (out) => {
      try {
        const p = await prepared(settings);
        const total = p.selected.reduce((x, k) => x + (p.rows[k] ?? 0), 0);
        const result = await withClient((client) =>
          insertEvents(client, generate(s.db, p.options), {
            truncate,
            dryRun,
            onProgress: (info) => void out.writeSSE({ event: "progress", data: sseData(info) }),
          }),
        );
        await addHistory({
          connectionName: s.name,
          connectionUrl: s.url,
          tables: p.selected,
          rows: result.totalRows || total,
          seed: settings.seed,
          format: "sql",
          action: dryRun ? "dry-run" : "insert",
          settings: { rowsPerTable: settings.rows, nullRatio: settings.nullRatio, ...(Object.keys(settings.tableRows).length ? { tableRows: settings.tableRows } : {}) },
        }).catch(() => undefined);
        await out.writeSSE({ event: "done", data: sseData({ ...result, database: s.info.database, dryRun }) });
      } catch (e) {
        const details = e instanceof InsertError ? e.details : {};
        await out.writeSSE({ event: "error", data: sseData({ code: e instanceof InsertError ? "INSERT_FAILED" : (e as { code?: string }).code ?? "ERROR", message: redactText(e instanceof Error ? e.message : String(e)), details, dryRun }) });
      } finally {
        busy = false;
      }
    });
  });

  /* ───────── history ───────── */
  app.get("/api/history", async (c) => c.json({ history: await listHistory() }));
  app.post("/api/history", async (c) => {
    const s = need();
    const raw = (await c.req.json().catch(() => null)) as { settings?: unknown; action?: unknown } | null;
    const settings = parseSettings(raw?.settings);
    if (raw?.action !== "copy") throw new BadRequest('Only the "copy" action can be logged from the browser.');
    const entry: HistoryEntry = await addHistory({
      connectionName: s.name,
      connectionUrl: s.url,
      tables: settings.tables,
      rows: 0,
      seed: settings.seed,
      format: settings.format,
      action: "copy",
      settings: { rowsPerTable: settings.rows, nullRatio: settings.nullRatio },
    });
    return c.json({ id: entry.id });
  });

  /* ───────── static Studio ───────── */
  app.get("*", async (c) => serveStatic(deps.assetsDir, new URL(c.req.url).pathname, deps.guard.token));
  return app;
}
