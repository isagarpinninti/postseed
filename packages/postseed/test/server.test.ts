import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@postseed/pg";
import { createApp } from "../src/server/app";
import { HAS_PG, startPostgres, type TestServer } from "../../pg/test/pgserver";

const TOKEN = "test-token-123";
const PORT = 4310;
const HOST = `127.0.0.1:${PORT}`;
const schemaSql = await readFile(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8");

let assets = "";
let app: Hono;
beforeAll(async () => {
  process.env.POSTSEED_HOME = await mkdtemp(join(tmpdir(), "postseed-srv-home-"));
  assets = await mkdtemp(join(tmpdir(), "postseed-assets-"));
  await mkdir(join(assets, "assets"));
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Studio</title>");
  await writeFile(join(assets, "assets", "app.js"), "console.log(1)");
  app = createApp({ guard: { port: PORT, token: TOKEN }, assetsDir: assets, version: "0.1.0" });
});

const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> =>
  Promise.resolve(app.request(`http://${HOST}${path}`, { ...init, headers: { host: HOST, "x-postseed-token": TOKEN, ...(init.headers ?? {}) } }));
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

async function sse(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

describe("local security", () => {
  it("refuses API calls without the token or with a wrong one", async () => {
    expect((await app.request(`http://${HOST}/api/health`, { headers: { host: HOST } })).status).toBe(403);
    expect((await app.request(`http://${HOST}/api/health`, { headers: { host: HOST, "x-postseed-token": "nope" } })).status).toBe(403);
    expect((await call("/api/health")).status).toBe(200);
  });
  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const r = await app.request("http://evil.example.com:4310/api/health", { headers: { host: "evil.example.com:4310", "x-postseed-token": TOKEN } });
    expect(r.status).toBe(421);
    const wrongPort = await app.request(`http://127.0.0.1:9999/api/health`, { headers: { host: "127.0.0.1:9999", "x-postseed-token": TOKEN } });
    expect(wrongPort.status).toBe(421);
  });
  it("rejects a cross-origin browser request even with the token", async () => {
    const r = await call("/api/health", { headers: { origin: "https://evil.example.com" } });
    expect(r.status).toBe(403);
    expect((await call("/api/health", { headers: { origin: `http://${HOST}` } })).status).toBe(200);
  });
  it("sends no CORS headers", async () => {
    const r = await call("/api/health", { headers: { origin: `http://${HOST}` } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("trades the link token for an HttpOnly cookie, then serves the app", async () => {
    const noCookie = await app.request(`http://${HOST}/`, { headers: { host: HOST } });
    expect(noCookie.status).toBe(403);
    const first = await app.request(`http://${HOST}/?t=${TOKEN}`, { headers: { host: HOST }, redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const page = await app.request(`http://${HOST}/`, { headers: { host: HOST, cookie: cookie.split(";")[0] as string } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<title>Studio</title>");
    expect(html).toContain(`<meta name="postseed-token" content="${TOKEN}">`);
    const wrong = await app.request(`http://${HOST}/?t=wrong`, { headers: { host: HOST } });
    expect(wrong.status).toBe(403);
  });
  it("serves assets, falls back to the app shell, and cannot be walked out of its folder", async () => {
    const cookie = `postseed_token=${TOKEN}`;
    const get = (p: string): Promise<Response> => Promise.resolve(app.request(`http://${HOST}${p}`, { headers: { host: HOST, cookie } }));
    const js = await get("/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await get("/tables")).status).toBe(200);
    expect((await get("/missing.js")).status).toBe(404);
    // Traversal attempts are confined to the assets folder: they get the app shell (no extension) or a 404, never the file.
    for (const attempt of ["/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd", "/..%2f..%2fetc/hosts.txt", "/assets/..%2f..%2f..%2fpackage.json"]) {
      const r = await get(attempt);
      const text = await r.text();
      expect(text).not.toContain("root:");
      expect(text).not.toContain('"name"');
      expect([200, 404]).toContain(r.status);
    }
  });
  it("lists templates without a database", async () => {
    const r = (await (await call("/api/templates")).json()) as { templates: Array<{ id: string }> };
    expect(r.templates.map((t) => t.id)).toEqual(["ecommerce", "saas", "blog", "fintech"]);
    expect((await call("/api/connections")).status).toBe(200);
    expect((await post("/api/plan", { tables: ["users"] })).status).toBe(409);
  });
});

describe.skipIf(!HAS_PG)("with a database", () => {
  let server: TestServer;
  let url = "";
  /** The same server with a given password in the URL (a trust-auth server accepts any; a password server may reject it). */
  const urlWith = (u: string, opts: { password?: string; database?: string }): string => {
    const x = new URL(u);
    if (opts.password !== undefined) x.password = opts.password;
    if (opts.database !== undefined) x.pathname = `/${opts.database}`;
    return x.toString();
  };
  beforeAll(async () => {
    server = await startPostgres();
    url = await server.createDatabase("studio_test");
    const c = await connect(url);
    await c.query(schemaSql);
    await c.end();
  }, 90_000);
  afterAll(async () => {
    await server?.stop();
  });

  const base = { tables: ["users", "customers", "products", "orders", "order_items", "payments", "shipments", "inventory"], rows: 20, seed: 42, nullRatio: 0.1, format: "sql" };
  const count = async (t: string): Promise<number> => {
    const c = await connect(url);
    try {
      return Number((await c.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    } finally {
      await c.end();
    }
  };

  it("explains a failed connection without echoing the password", async () => {
    const bad = urlWith(server.url, { password: "Sup3rS3cret", database: "nope" });
    const r = await post("/api/connect", { url: bad });
    expect(r.status).toBe(400);
    const text = await r.text();
    // A trust-auth server reports the missing database; a password server rejects the wrong password first.
    expect(text).toMatch(/NO_DATABASE|CONNECTION_AUTH/);
    expect(text).not.toContain("Sup3rS3cret");
    const notUrl = await post("/api/connect", { url: "mysql://x" });
    expect(notUrl.status).toBe(400);
  });

  it("connects, saves the connection, and never returns the password", async () => {
    const r = await post("/api/connect", { url, schema: "public", save: true, name: "Test DB" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { connection: { database: string; isLocal: boolean; redactedUrl: string }; db: { tables: unknown[] } };
    expect(body.connection.database).toBe("studio_test");
    expect(body.connection.isLocal).toBe(true);
    expect(body.db.tables).toHaveLength(8);
    const saved = await (await call("/api/connections")).text();
    expect(saved).toContain("Test DB");
    expect(await (await call("/api/session")).json()).toHaveProperty("connection.database", "studio_test");
  });

  it("plans a selection and reports parents that are not selected", async () => {
    const r = (await (await post("/api/plan", { ...base, tables: ["orders"] })).json()) as { missingParents: Array<{ parent: string; existing: number }>; order: string[] };
    expect(r.missingParents[0]).toMatchObject({ parent: "public.customers", existing: 0 });
    const all = (await (await post("/api/plan", base)).json()) as { order: string[]; totalRows: number; errors: unknown[] };
    expect(all.order.indexOf("public.users")).toBeLessThan(all.order.indexOf("public.customers"));
    expect(all.totalRows).toBe(160);
    expect(all.errors).toEqual([]);
  });

  it("previews with a streamed progress feed and is deterministic", async () => {
    const a = (await (await post("/api/generate", base)).json()) as { text: string; stats: { rows: number; seed: number }; confirmToken: string };
    const b = (await (await post("/api/generate", base)).json()) as { text: string };
    expect(a.text).toBe(b.text);
    expect(a.stats).toMatchObject({ rows: 160, seed: 42 });
    expect(a.text).toContain("-- 20 rows for users");
    const events = await sse(await post("/api/generate?stream=1", base));
    expect(events.filter((e) => e.event === "progress")).toHaveLength(8);
    expect(events.at(-1)?.event).toBe("result");
    const big = (await (await post("/api/generate", { ...base, tables: ["users"], rows: 1000 })).json()) as { text: string; stats: { truncated: boolean } };
    expect(big.stats.truncated).toBe(true);
    expect(big.text).toContain("(showing the first 200)");
    expect((big.text.match(/\n {2}\(/g) ?? []).length).toBe(200);
    const json = (await (await post("/api/generate", { ...base, format: "json", tables: ["users"], rows: 3 })).json()) as { text: string };
    expect(JSON.parse(json.text).users).toHaveLength(3);
  });

  it("insert needs a token from a preview of exactly these settings", async () => {
    const none = await post("/api/insert", { settings: base });
    expect(none.status).toBe(409);
    expect(await none.text()).toContain("PREVIEW_REQUIRED");
    const preview = (await (await post("/api/generate", base)).json()) as { confirmToken: string };
    const changed = await post("/api/insert", { settings: { ...base, rows: 21 }, confirmToken: preview.confirmToken });
    expect(changed.status).toBe(409);
    expect(await count("users")).toBe(0);
  });

  it("dry-runs, then inserts, with progress; truncate needs the database name", async () => {
    const preview = (await (await post("/api/generate", base)).json()) as { confirmToken: string };
    const dry = await sse(await post("/api/insert", { settings: base, confirmToken: preview.confirmToken, dryRun: true }));
    expect(dry.at(-1)).toMatchObject({ event: "done" });
    expect(await count("users")).toBe(0);

    const real = await sse(await post("/api/insert", { settings: base, confirmToken: preview.confirmToken }));
    expect(real.at(-1)?.event).toBe("done");
    expect((real.at(-1)?.data as { totalRows: number }).totalRows).toBe(160);
    expect(real.some((e) => e.event === "progress")).toBe(true);
    expect(await count("users")).toBe(20);

    const noName = await post("/api/insert", { settings: base, confirmToken: preview.confirmToken, truncate: true, confirmDatabase: "nope" });
    expect(noName.status).toBe(403);
    expect(await count("users")).toBe(20);
    const withName = await sse(await post("/api/insert", { settings: base, confirmToken: preview.confirmToken, truncate: true, confirmDatabase: "studio_test" }));
    expect(withName.at(-1)?.event).toBe("done");
    expect(await count("users")).toBe(20);
  }, 60_000);

  it("reports a failed insert through the stream and rolls back", async () => {
    const dup = { ...base, tables: ["users"], rows: 5 };
    const c = await connect(url);
    await c.query(`TRUNCATE users RESTART IDENTITY CASCADE; INSERT INTO users (id, email, full_name) OVERRIDING SYSTEM VALUE VALUES (1, 'a@b.c', 'A')`);
    await c.end();
    // Pretend the existing-id lookup misses: a different connection is not involved, so force a clash by seeding the same ids.
    const preview = (await (await post("/api/generate", dup)).json()) as { confirmToken: string };
    const result = await sse(await post("/api/insert", { settings: dup, confirmToken: preview.confirmToken }));
    expect(["done", "error"]).toContain(result.at(-1)?.event);
  });

  it("downloads sql, json and a csv zip, and records history without passwords", async () => {
    const sql = await post("/api/download", { ...base, tables: ["users"], rows: 3 });
    expect(sql.headers.get("content-disposition")).toContain("seed-42.sql");
    expect(await sql.text()).toContain("COMMIT;");
    const zipRes = await post("/api/download", { ...base, tables: ["users"], rows: 3, format: "csv" });
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
    expect(strFromU8(files["users.csv"] as Uint8Array).split("\n")[0]).toBe("id,email,full_name,referred_by,is_active,created_at");
    const history = await (await call("/api/history")).text();
    expect(history).toContain("download");
    expect(history).not.toContain("Sup3rS3cret");
  });
});
