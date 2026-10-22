import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { parseDdl, type Database, type ExistingData, type GenerateOptions } from "@postseed/core";
import { connect, introspect, loadExisting, type ConnectionInfo, describeConnection } from "@postseed/pg";
import type { Client } from "@postseed/pg";
import { loadConfig, type PostseedConfig } from "./config";
import type { Io } from "./io";

export class UsageError extends Error {}

export const COMMON_FLAGS = {
  schema: { type: "string" },
  url: { type: "string" },
  "db-schema": { type: "string" },
  rows: { type: "string" },
  "table-rows": { type: "string" },
  seed: { type: "string" },
  tables: { type: "string" },
  "null-ratio": { type: "string" },
  "fk-distribution": { type: "string" },
  now: { type: "string" },
  config: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export function parseFlags<T extends Record<string, { type: "string" | "boolean"; short?: string }>>(
  argv: string[],
  extra: T,
): { values: Record<string, string | boolean | undefined>; positionals: string[] } {
  try {
    const r = parseArgs({ args: argv, options: { ...COMMON_FLAGS, ...extra } as never, allowPositionals: true, strict: true });
    return { values: r.values as Record<string, string | boolean | undefined>, positionals: r.positionals };
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message.replace(/^Unknown option/, "Unknown option") : String(e));
  }
}

const int = (name: string, v: string | boolean | undefined, min: number, max: number): number | undefined => {
  if (v === undefined || v === true || v === false) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number between ${min} and ${max}.`);
  return n;
};

export interface Resolved {
  config: PostseedConfig;
  options: GenerateOptions;
  schemaFile?: string;
  url?: string;
  dbSchema: string;
}

/** Merges config file and flags (flags win) into engine options. */
export async function resolveOptions(io: Io, values: Record<string, string | boolean | undefined>): Promise<Resolved> {
  const { config } = await loadConfig(io.cwd, typeof values.config === "string" ? values.config : undefined);
  const options: GenerateOptions = {};
  const rows = int("rows", values.rows, 0, 10_000_000) ?? config.rows;
  if (rows !== undefined) options.rows = rows;
  const seed = int("seed", values.seed, -2_147_483_648, 4_294_967_295) ?? config.seed;
  if (seed !== undefined) options.seed = seed;
  let nullRatio = config.nullRatio;
  if (typeof values["null-ratio"] === "string") {
    const n = Number(values["null-ratio"]);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new UsageError("--null-ratio must be between 0 and 1 (for example 0.1).");
    nullRatio = n;
  }
  if (nullRatio !== undefined) options.nullRatio = nullRatio;
  const tableRows: Record<string, number> = { ...(config.tableRows ?? {}) };
  if (typeof values["table-rows"] === "string") {
    for (const part of values["table-rows"].split(",").filter(Boolean)) {
      const [name, n] = part.split("=");
      const count = Number(n);
      if (!name || !Number.isInteger(count) || count < 0) throw new UsageError(`--table-rows expects name=count pairs, got "${part}".`);
      tableRows[name.trim()] = count;
    }
  }
  if (Object.keys(tableRows).length > 0) options.tableRows = tableRows;
  const tables = typeof values.tables === "string" ? values.tables.split(",").map((s) => s.trim()).filter(Boolean) : config.tables;
  if (tables && tables.length > 0) options.tables = tables;
  if (config.overrides) options.overrides = config.overrides;
  const dist = (values["fk-distribution"] as string | undefined) ?? config.fkDistribution;
  if (dist !== undefined) {
    if (dist !== "uniform" && dist !== "zipf") throw new UsageError('--fk-distribution must be "uniform" or "zipf".');
    options.fkDistribution = dist;
  }
  if (typeof values.now === "string") {
    if (Number.isNaN(new Date(values.now).getTime())) throw new UsageError("--now must be a date such as 2026-01-01.");
    options.now = values.now;
  }
  return {
    config,
    options,
    ...(typeof values.schema === "string" ? { schemaFile: values.schema } : {}),
    ...(typeof values.url === "string" ? { url: values.url } : io.env.DATABASE_URL && values.schema === undefined ? { url: io.env.DATABASE_URL } : {}),
    dbSchema: (typeof values["db-schema"] === "string" ? values["db-schema"] : config.dbSchema) ?? "public",
  };
}

export async function readSchemaFile(io: Io, file: string): Promise<string> {
  if (file === "-") return io.readStdin();
  try {
    return await readFile(resolve(io.cwd, file), "utf8");
  } catch (e) {
    throw new UsageError(`Cannot read schema file ${file}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : (e as Error).message}`);
  }
}

export interface Source {
  db: Database;
  existing?: ExistingData;
  client?: Client;
  info?: ConnectionInfo;
  close: () => Promise<void>;
}

/** Loads the schema from a DDL file or a live database. For a database it also reads what appending needs. */
export async function openSource(io: Io, r: Resolved, _opts: { needExisting: boolean }): Promise<Source> {
  if (r.schemaFile) {
    const db = parseDdl(await readSchemaFile(io, r.schemaFile));
    return { db, close: async () => undefined };
  }
  if (!r.url) throw new UsageError("Provide a schema with --schema <file.sql>, or a database with --url <postgres://…> (or set DATABASE_URL).");
  const client = await connect(r.url);
  const info = await describeConnection(client, r.url);
  const db = await introspect(client, r.dbSchema.split(",").map((s) => s.trim()));
  return { db, client, info, close: async () => void (await client.end().catch(() => undefined)) };
}

export async function withExisting(src: Source, selected: string[]): Promise<ExistingData | undefined> {
  if (!src.client) return undefined;
  return loadExisting(src.client, src.db, selected);
}
