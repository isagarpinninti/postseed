import { generate, getTable, tableKey, uniqueKey, type Column, type Database, type GenEvent, type GenerateOptions, type Value } from "../src";

export interface Rows {
  columns: Column[];
  rows: Value[][];
}

/** Runs the generator and applies cycle UPDATEs, returning final rows per table key. */
export function collect(db: Database, options: GenerateOptions = {}): { tables: Map<string, Rows>; events: GenEvent[] } {
  const events = [...generate(db, options)];
  const tables = new Map<string, Rows>();
  for (const e of events) {
    if (e.type === "table") tables.set(e.key, { columns: e.columns, rows: [] });
    else if (e.type === "rows") tables.get(e.key)?.rows.push(...e.rows);
    else if (e.type === "updates") {
      const t = tables.get(e.key) as Rows;
      const pk = e.pkColumns.map((c) => t.columns.findIndex((x) => x.name === c.name));
      const set = e.setColumns.map((c) => t.columns.findIndex((x) => x.name === c.name));
      const byPk = new Map(t.rows.map((r) => [JSON.stringify(pk.map((x) => r[x])), r]));
      for (const u of e.rows) {
        const row = byPk.get(JSON.stringify(u.pk));
        if (row) set.forEach((x, k) => (row[x] = u.set[k] as Value));
      }
    }
  }
  return { tables, events };
}

/** Everything the database would reject, computed in memory. Returns a list of violations. */
export function violations(db: Database, tables: Map<string, Rows>, existing: Record<string, Rows> = {}): string[] {
  const out: string[] = [];
  const lookup = (key: string): Rows | undefined => tables.get(key) ?? existing[key];
  for (const [key, data] of tables) {
    const t = getTable(db, key);
    const idx = (name: string): number => data.columns.findIndex((c) => c.name === name);
    // NOT NULL
    for (const c of t.columns) {
      const i = idx(c.name);
      if (i < 0 || c.nullable) continue;
      if (data.rows.some((r) => r[i] === null)) out.push(`${key}.${c.name} has NULL but is NOT NULL`);
    }
    // PK and UNIQUE
    const constraints = [t.primaryKey, ...t.uniques.map((u) => u.columns)].filter((c) => c.length > 0);
    for (const cols of constraints) {
      const seen = new Set<string>();
      for (const r of data.rows) {
        const k = uniqueKey(cols.map((c) => r[idx(c)] as Value));
        if (k === null) continue;
        if (seen.has(k)) out.push(`${key} duplicates ${cols.join(",")}`);
        seen.add(k);
      }
    }
    // FK: no orphans
    for (const fk of t.foreignKeys) {
      const parentKey = `${fk.refSchema}.${fk.refTable}`;
      const parent = lookup(parentKey);
      if (!parent) continue;
      const pIdx = fk.refColumns.map((c) => parent.columns.findIndex((x) => x.name === c));
      const have = new Set(parent.rows.map((r) => JSON.stringify(pIdx.map((x) => r[x]))));
      const cIdx = fk.columns.map(idx);
      if (cIdx.some((x) => x < 0)) continue;
      for (const r of data.rows) {
        const vals = cIdx.map((x) => r[x] as Value);
        if (vals.some((v) => v === null)) continue;
        if (!have.has(JSON.stringify(vals))) out.push(`${key}(${fk.columns.join(",")}) orphan ${JSON.stringify(vals)}`);
      }
    }
    // CHECKs that compare two columns
    for (const rel of t.relations ?? []) {
      const li = idx(rel.left);
      const ri = idx(rel.right);
      if (li < 0 || ri < 0) continue;
      for (const r of data.rows) {
        const a = r[li];
        const b = r[ri];
        if (a === null || b === null) continue;
        const asComparable = (v: Value): number | string => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : typeof v === "number" || typeof v === "string" ? v : JSON.stringify(v));
        const x = asComparable(a as Value);
        const y = asComparable(b as Value);
        const ok = rel.op === "<>" ? x !== y : rel.op === ">" ? x > y : rel.op === ">=" ? x >= y : rel.op === "<" ? x < y : x <= y;
        if (!ok) out.push(`${key}: ${rel.left} ${rel.op} ${rel.right} violated by ${String(a)} / ${String(b)}`);
      }
    }
    // enums and checks
    for (const c of t.columns) {
      const i = idx(c.name);
      if (i < 0) continue;
      if (c.type.kind === "enum" && c.type.array === 0) {
        const e = db.enums.find((x) => `${x.schema}.${x.name}` === c.type.enumKey);
        for (const r of data.rows) if (r[i] !== null && !e?.values.includes(r[i] as string)) out.push(`${key}.${c.name} invalid enum ${String(r[i])}`);
      }
      const ck = c.check;
      if (ck && c.type.array === 0) {
        for (const r of data.rows) {
          const v = r[i];
          if (v === null) continue;
          const n = typeof v === "string" && c.type.kind !== "text" && c.type.kind !== "varchar" && c.type.kind !== "char" ? Number(v) : v;
          if (typeof n === "number") {
            if (ck.min !== undefined && (ck.minExclusive ? n <= ck.min : n < ck.min)) out.push(`${key}.${c.name}=${n} below min`);
            if (ck.max !== undefined && (ck.maxExclusive ? n >= ck.max : n > ck.max)) out.push(`${key}.${c.name}=${n} above max`);
          }
          if (ck.in && !ck.in.map(String).includes(String(v))) out.push(`${key}.${c.name}=${String(v)} not in list`);
          if (typeof v === "string") {
            if (ck.maxLen !== undefined && v.length > ck.maxLen) out.push(`${key}.${c.name} too long`);
            if (ck.minLen !== undefined && v.length < ck.minLen) out.push(`${key}.${c.name} too short`);
          }
        }
      }
      if (c.type.length !== undefined && (c.type.kind === "varchar" || c.type.kind === "char")) {
        for (const r of data.rows) if (typeof r[i] === "string" && (r[i] as string).length > (c.type.length as number)) out.push(`${key}.${c.name} exceeds length`);
      }
    }
  }
  return out;
}

export const keysOf = (db: Database): string[] => db.tables.map(tableKey);
