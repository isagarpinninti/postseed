import { copyText, getTable, qualified, quoteIdent, valueToText, type Column, type Database, type GenEvent, type Table, type Value } from "@postseed/core";
import type pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { redactText } from "./connection";

export interface InsertOptions {
  /** Empty the selected tables first (TRUNCATE ... RESTART IDENTITY CASCADE). Destructive; opt-in. */
  truncate?: boolean;
  /** Do everything, then roll back, to validate CHECK, unique and foreign keys against the real database. */
  dryRun?: boolean;
  /** Tables with more rows than this use COPY (default 1000). */
  copyThreshold?: number;
  onProgress?: (p: { table: string; rows: number; total: number }) => void;
}

export interface TableResult {
  key: string;
  rows: number;
  ms: number;
}

export interface InsertResult {
  committed: boolean;
  dryRun: boolean;
  tables: TableResult[];
  totalRows: number;
  ms: number;
  truncated: string[];
}

export class InsertError extends Error {
  constructor(
    message: string,
    readonly details: {
      table?: string;
      /** 1-based row number within the table, when it could be pinned down. */
      rowIndex?: number;
      constraint?: string;
      detail?: string;
      pgCode?: string;
    },
  ) {
    super(message);
    this.name = "InsertError";
  }
}

interface PgError {
  message?: string;
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  where?: string;
}

const toError = (e: unknown, table?: string, rowIndex?: number): InsertError => {
  const p = (e ?? {}) as PgError;
  const where = table ? ` in ${table}${rowIndex ? ` at row ${rowIndex}` : ""}` : "";
  const detail = p.detail ? ` ${redactText(p.detail)}` : "";
  return new InsertError(`${redactText(p.message ?? String(e))}${detail ? ` —${detail}` : ""}${where ? ` (${where.trim()})` : ""}`, {
    ...(table ? { table } : {}),
    ...(rowIndex ? { rowIndex } : {}),
    ...(p.constraint ? { constraint: p.constraint } : {}),
    ...(p.detail ? { detail: redactText(p.detail) } : {}),
    ...(p.code ? { pgCode: p.code } : {}),
  });
};

const param = (v: Value): string | number | boolean | null => {
  if (v === null) return null;
  if (typeof v === "number") return v;
  return valueToText(v);
};

/** Tables that `TRUNCATE ... CASCADE` would also empty because they reference the selection. */
export function truncateImpact(db: Database, selected: readonly string[]): string[] {
  const all = new Set(selected);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of db.tables) {
      const k = `${t.schema}.${t.name}`;
      if (all.has(k)) continue;
      if (t.foreignKeys.some((fk) => all.has(`${fk.refSchema}.${fk.refTable}`))) {
        all.add(k);
        grew = true;
      }
    }
  }
  return [...all].filter((k) => !selected.includes(k));
}

async function insertBatch(client: pg.Client, table: Table, columns: Column[], rows: Value[][], overriding: boolean): Promise<void> {
  const cols = columns.map((c) => quoteIdent(c.name)).join(", ");
  const sql = (n: number): string => {
    const groups: string[] = [];
    for (let r = 0; r < n; r++) groups.push(`(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(", ")})`);
    return `INSERT INTO ${qualified(table.schema, table.name)} (${cols})${overriding ? " OVERRIDING SYSTEM VALUE" : ""} VALUES ${groups.join(", ")}`;
  };
  await client.query(sql(rows.length), rows.flatMap((r) => r.map(param)));
}

async function copyRows(client: pg.Client, table: Table, columns: Column[], rows: Value[][]): Promise<void> {
  const cols = columns.map((c) => quoteIdent(c.name)).join(", ");
  const stream = client.query(copyFrom(`COPY ${qualified(table.schema, table.name)} (${cols}) FROM STDIN`));
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);
    let i = 0;
    const pump = (): void => {
      let ok = true;
      while (ok && i < rows.length) {
        const row = rows[i++] as Value[];
        ok = stream.write(`${row.map((v) => copyText(v)).join("\t")}\n`);
      }
      if (i >= rows.length) stream.end();
      else stream.once("drain", pump);
    };
    pump();
  });
}

/** Finds the first row of a failed batch by retrying one at a time under savepoints. */
async function pinpoint(client: pg.Client, table: Table, columns: Column[], rows: Value[][], overriding: boolean, offset: number, cause: unknown): Promise<InsertError> {
  for (let i = 0; i < rows.length; i++) {
    await client.query("SAVEPOINT pinpoint");
    try {
      await insertBatch(client, table, columns, [rows[i] as Value[]], overriding);
      await client.query("RELEASE SAVEPOINT pinpoint");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT pinpoint").catch(() => undefined);
      return toError(e, table.name, offset + i + 1);
    }
  }
  return toError(cause, table.name);
}

/**
 * Streams generated events into the database inside ONE transaction. Any failure rolls everything
 * back and names the table, row and constraint. A dry run validates the same way and always rolls back.
 */
export async function insertEvents(client: pg.Client, events: Iterable<GenEvent>, options: InsertOptions = {}): Promise<InsertResult> {
  const started = Date.now();
  const threshold = options.copyThreshold ?? 1000;
  const results: TableResult[] = [];
  const truncated: string[] = [];
  let current: { key: string; started: number; total: number; done: number } | undefined;
  let finished = false;
  await client.query("BEGIN");
  try {
    for (const e of events) {
      switch (e.type) {
        case "begin": {
          if (e.deferConstraints) await client.query("SET CONSTRAINTS ALL DEFERRED");
          if (options.truncate) {
            const names = e.tables.map((t) => {
              const [schema, ...rest] = t.key.split(".");
              return qualified(schema as string, rest.join("."));
            });
            if (names.length > 0) await client.query(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`);
            truncated.push(...e.tables.map((t) => t.key));
          }
          break;
        }
        case "table":
          current = { key: e.key, started: Date.now(), total: e.rows, done: 0 };
          break;
        case "rows": {
          const overriding = e.columns.some((c) => c.identity === "always");
          const useCopy = (current?.total ?? 0) > threshold && !overriding;
          if (useCopy) {
            await client.query("SAVEPOINT batch");
            try {
              await copyRows(client, e.table, e.columns, e.rows);
              await client.query("RELEASE SAVEPOINT batch");
            } catch (err) {
              await client.query("ROLLBACK TO SAVEPOINT batch").catch(() => undefined);
              throw await pinpoint(client, e.table, e.columns, e.rows, overriding, e.offset, err);
            }
          } else {
            const perBatch = Math.max(1, Math.min(500, Math.floor(60000 / Math.max(1, e.columns.length))));
            for (let at = 0; at < e.rows.length; at += perBatch) {
              const slice = e.rows.slice(at, at + perBatch);
              await client.query("SAVEPOINT batch");
              try {
                await insertBatch(client, e.table, e.columns, slice, overriding);
                await client.query("RELEASE SAVEPOINT batch");
              } catch (err) {
                await client.query("ROLLBACK TO SAVEPOINT batch").catch(() => undefined);
                throw await pinpoint(client, e.table, e.columns, slice, overriding, e.offset + at, err);
              }
            }
          }
          if (current) {
            current.done += e.rows.length;
            options.onProgress?.({ table: current.key, rows: current.done, total: current.total });
          }
          break;
        }
        case "table-end": {
          if (current) results.push({ key: current.key, rows: current.done, ms: Date.now() - current.started });
          // setval is the one thing a ROLLBACK cannot undo, so a dry run leaves sequences alone.
          if (!options.dryRun) {
            for (const s of e.sequences) {
              await client.query("SELECT setval(pg_get_serial_sequence($1, $2), $3, true)", [qualified(e.table.schema, e.table.name), s.column, s.value]);
            }
          }
          break;
        }
        case "updates": {
          const target = qualified(e.table.schema, e.table.name);
          const set = e.setColumns.map((c, k) => `${quoteIdent(c.name)} = $${k + 1}`).join(", ");
          const where = e.pkColumns.map((c, k) => `${quoteIdent(c.name)} = $${e.setColumns.length + k + 1}`).join(" AND ");
          for (const r of e.rows) await client.query(`UPDATE ${target} SET ${set} WHERE ${where}`, [...r.set.map(param), ...r.pk.map(param)]);
          break;
        }
        case "end":
          break;
      }
    }
    finished = true;
    await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    if (!finished) await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof InsertError) throw err;
    throw toError(err, current?.key.split(".").slice(1).join("."));
  }
  const totalRows = results.reduce((n, r) => n + r.rows, 0);
  return { committed: !options.dryRun, dryRun: !!options.dryRun, tables: results, totalRows, ms: Date.now() - started, truncated };
}

/** Actual row counts, for verifying an insert. */
export async function countRows(client: pg.Client, db: Database, keys: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const t = getTable(db, k);
    const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${qualified(t.schema, t.name)}`);
    out[k] = Number(r.rows[0]?.n ?? 0);
  }
  return out;
}
