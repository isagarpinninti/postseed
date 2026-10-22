import { generate, parseDdl, prepare, previewEvents, renderText, writeCsv, writeJson, writeSql, PostseedError, type GenerateOptions } from "@postseed/core";
import { strToU8, zipSync } from "fflate";
import type { Format } from "../lib/types";

export interface ClientRequest {
  ddl: string;
  rows: number;
  seed: number;
  nullRatio: number;
  format: Format;
  /** Rows of each table to render in the preview; the downloaded file always has them all. */
  previewRows?: number;
}

export interface ClientResult {
  text: string;
  tables: number;
  rows: number;
  bytes: number;
  ms: number;
  warnings: string[];
  truncated: boolean;
}

export type ClientOutcome = { ok: true; result: ClientResult } | { ok: false; error: string; warnings: string[] };

function options(r: ClientRequest, tables?: string[]): GenerateOptions {
  return { seed: r.seed, rows: r.rows, nullRatio: r.nullRatio, ...(tables ? { tables } : {}) };
}

/** Runs the whole engine in the page (or a worker): schema text in, preview out. Nothing is sent anywhere. */
export function runClient(r: ClientRequest): ClientOutcome {
  const started = performance.now();
  const db = parseDdl(r.ddl);
  if (db.tables.length === 0) {
    return { ok: false, error: db.warnings[0] ?? "No CREATE TABLE statements were found in the schema.", warnings: db.warnings };
  }
  try {
    const prep = prepare(db, options(r));
    if (prep.errors.length > 0) return { ok: false, error: prep.errors.map((e) => e.message).join("\n"), warnings: prep.warnings };
    const limit = r.previewRows ?? 200;
    const events = [...generate(db, options(r))];
    const total = events.reduce((n, e) => n + (e.type === "rows" ? e.rows.length : 0), 0);
    const taken = new Map<string, number>();
    for (const e of events) if (e.type === "rows") taken.set(e.key, Math.min(limit, (taken.get(e.key) ?? 0) + e.rows.length));
    const text = [...renderText(previewEvents(events, limit), r.format)].join("");
    const shownRows = [...taken.values()].reduce((a, b) => a + b, 0);
    const bytes = shownRows > 0 ? Math.round((new TextEncoder().encode(text).length * total) / shownRows) : text.length;
    return {
      ok: true,
      result: { text, tables: prep.selected.length, rows: total, bytes, ms: Math.round(performance.now() - started), warnings: prep.warnings, truncated: [...Object.values(prep.rows)].some((n) => n > limit) },
    };
  } catch (e) {
    if (e instanceof PostseedError) return { ok: false, error: e.message, warnings: db.warnings };
    return { ok: false, error: e instanceof Error ? e.message : String(e), warnings: db.warnings };
  }
}

/** The complete file for download (not just the preview). */
export function buildFile(r: ClientRequest): { name: string; blob: Blob } | { error: string } {
  const db = parseDdl(r.ddl);
  try {
    const events = generate(db, options(r));
    if (r.format === "sql") return { name: `seed-${r.seed}.sql`, blob: new Blob([[...writeSql(events)].join("")], { type: "application/sql" }) };
    if (r.format === "json") return { name: `seed-${r.seed}.json`, blob: new Blob([[...writeJson(events)].join("")], { type: "application/json" }) };
    const files = new Map<string, string[]>();
    for (const c of writeCsv(events)) files.set(c.file, [...(files.get(c.file) ?? []), c.text]);
    const zip: Record<string, Uint8Array> = {};
    for (const [name, parts] of files) zip[name] = strToU8(parts.join(""));
    const zipped = zipSync(zip);
    return { name: `seed-${r.seed}.zip`, blob: new Blob([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer], { type: "application/zip" }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
