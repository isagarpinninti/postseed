import { findMissingParents, getTable, qualified, quoteIdent, uniqueKey, type Column, type Database, type ExistingData, type Value } from "@postseed/core";
import type pg from "pg";

/** Converts a text value from the driver into the JS value the generator would have produced. */
export function coerce(raw: string | null, column: Column): Value {
  if (raw === null || raw === undefined) return null;
  switch (column.type.kind) {
    case "smallint":
    case "int":
    case "bigint": {
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : raw;
    }
    case "float": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "bool":
      return raw === "t" || raw === "true";
    default:
      return raw;
  }
}

export interface LoadExistingOptions {
  /** Parent rows to read per unselected table (default 10000). */
  sampleLimit?: number;
  /** Existing unique tuples to read per constraint (default 1,000,000). */
  uniqueCap?: number;
}

const isIntegral = (c: Column): boolean => c.type.kind === "smallint" || c.type.kind === "int" || c.type.kind === "bigint";

/**
 * Reads what generation needs from the live database when appending: keys of parent tables that are
 * not being generated, the current maximum of sequential columns, and existing unique values.
 */
export async function loadExisting(
  client: pg.Client,
  db: Database,
  selected: readonly string[],
  options: LoadExistingOptions = {},
): Promise<ExistingData> {
  const limit = options.sampleLimit ?? 10_000;
  const cap = options.uniqueCap ?? 1_000_000;
  const out: Required<ExistingData> = { keys: {}, maxIds: {}, unique: {} };

  // Foreign keys into tables that are not selected.
  const wanted = new Map<string, Set<string>>();
  for (const k of selected) {
    const t = getTable(db, k);
    for (const fk of t.foreignKeys) {
      const parent = `${fk.refSchema}.${fk.refTable}`;
      if (selected.includes(parent)) continue;
      const set = wanted.get(parent) ?? new Set<string>();
      fk.refColumns.forEach((c) => set.add(c));
      wanted.set(parent, set);
    }
  }
  void findMissingParents;
  for (const [parentKey, cols] of wanted) {
    const parent = db.tables.find((t) => `${t.schema}.${t.name}` === parentKey);
    if (!parent) continue;
    const list = [...cols];
    const r = await client.query<Record<string, string | null>>(
      `SELECT ${list.map((c) => `${quoteIdent(c)}::text AS ${quoteIdent(c)}`).join(", ")} FROM ${qualified(parent.schema, parent.name)} LIMIT ${limit}`,
    );
    out.keys[parentKey] = r.rows.map((row) => {
      const rec: Record<string, Value> = {};
      for (const c of list) rec[c] = coerce(row[c] ?? null, parent.columns.find((x) => x.name === c) as Column);
      return rec;
    });
  }

  for (const k of selected) {
    const t = getTable(db, k);
    const target = qualified(t.schema, t.name);
    // Sequential columns continue after the current maximum.
    const sequential = t.columns.filter((c) => isIntegral(c) && (c.identity !== undefined || c.serial || (t.primaryKey.length === 1 && t.primaryKey[0] === c.name)));
    for (const c of sequential) {
      const r = await client.query<{ m: string | null }>(`SELECT max(${quoteIdent(c.name)})::text AS m FROM ${target}`);
      const m = r.rows[0]?.m;
      if (m !== null && m !== undefined) (out.maxIds[k] ??= {})[c.name] = Number(m);
    }
    // Existing unique tuples, so appended rows do not collide.
    const seqNames = new Set(sequential.map((c) => c.name));
    const constraints = [
      ...(t.primaryKey.length > 0 ? [{ columns: t.primaryKey, transform: undefined as "lower" | undefined }] : []),
      ...t.uniques.map((u) => ({ columns: u.columns, transform: u.transform })),
    ].filter((c) => !c.columns.some((x) => seqNames.has(x)));
    if (constraints.length === 0) continue;
    const any = await client.query(`SELECT 1 FROM ${target} LIMIT 1`);
    if (any.rowCount === 0) continue;
    for (const c of constraints) {
      const cols = c.columns.map((x) => t.columns.find((y) => y.name === x) as Column);
      const r = await client.query<Record<string, string | null>>(
        `SELECT ${c.columns.map((x) => `${quoteIdent(x)}::text AS ${quoteIdent(x)}`).join(", ")} FROM ${target} LIMIT ${cap}`,
      );
      const keys: string[] = [];
      for (const row of r.rows) {
        const key = uniqueKey(c.columns.map((x, i) => coerce(row[x] ?? null, cols[i] as Column)), c.transform === "lower");
        if (key !== null) keys.push(key);
      }
      (out.unique[k] ??= {})[c.columns.join(",")] = keys;
    }
  }
  return out;
}
