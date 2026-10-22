import { analyzeCheck, checkLabel, mergeCheck, parseType, type Column, type Database, type EnumType, type ForeignKey, type Table, type UniqueConstraint } from "@postseed/core";
import type pg from "pg";

interface TableRow {
  oid: string;
  schema: string;
  name: string;
}
interface ColumnRow {
  attrelid: string;
  attname: string;
  type: string;
  attnotnull: boolean;
  atthasdef: boolean;
  attidentity: string;
  attgenerated: string;
  def: string | null;
  typtype: string;
  basetype: string | null;
  domain_notnull: boolean | null;
}
interface ConstraintRow {
  conrelid: string;
  conname: string;
  contype: string;
  cols: string | null;
  ref_schema: string | null;
  ref_table: string | null;
  ref_cols: string | null;
  condeferrable: boolean;
  confdeltype: string;
  def: string;
}
interface IndexRow {
  indrelid: string;
  index_name: string;
  cols: string | null;
  partial: boolean;
  has_expr: boolean;
  def: string;
}

/** Every value arrives as text (see connection.ts), so booleans are 't' / 'f'. */
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";

const arr = (s: string | null): string[] => (s ? (JSON.parse(s) as string[]) : []);

const ON_DELETE: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

/**
 * Reads tables, columns, enums, keys and unique indexes from `pg_catalog`. `information_schema` is
 * not used: it hides enums, composite foreign keys and partial unique indexes.
 */
export async function introspect(client: pg.Client, schemas: string[] = ["public"]): Promise<Database> {
  const warnings: string[] = [];

  const enumRows = await client.query<{ schema: string; name: string; labels: string }>(
    `SELECT n.nspname AS schema, t.typname AS name,
            array_to_json(array_agg(e.enumlabel ORDER BY e.enumsortorder))::text AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname`,
  );
  const enums: EnumType[] = enumRows.rows.map((r) => ({ schema: r.schema, name: r.name, values: JSON.parse(r.labels) as string[] }));

  const tableRows = await client.query<TableRow>(
    `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY($1::text[])
      ORDER BY n.nspname, c.relname`,
    [schemas],
  );
  if (tableRows.rows.length === 0) return { tables: [], enums, warnings };
  const oids = tableRows.rows.map((t) => t.oid);

  const columnRows = await client.query<ColumnRow>(
    `SELECT a.attrelid::text AS attrelid, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull, a.atthasdef, a.attidentity::text AS attidentity, a.attgenerated::text AS attgenerated,
            pg_get_expr(d.adbin, d.adrelid) AS def,
            t.typtype::text AS typtype,
            CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS basetype,
            CASE WHEN t.typtype = 'd' THEN t.typnotnull END AS domain_notnull
       FROM pg_attribute a
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attrelid, a.attnum`,
    [oids],
  );

  const domainChecks = await client.query<{ name: string; def: string }>(
    `SELECT t.typname AS name, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_type t ON t.oid = c.contypid
      WHERE c.contype = 'c'`,
  );

  const constraintRows = await client.query<ConstraintRow>(
    `SELECT c.conrelid::text AS conrelid, c.conname, c.contype::text AS contype,
            (SELECT to_json(array_agg(a.attname::text ORDER BY k.ord))::text
               FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
            (SELECT n.nspname FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace WHERE r.oid = c.confrelid) AS ref_schema,
            (SELECT r.relname FROM pg_class r WHERE r.oid = c.confrelid) AS ref_table,
            (SELECT to_json(array_agg(a.attname::text ORDER BY k.ord))::text
               FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS ref_cols,
            c.condeferrable, c.confdeltype::text AS confdeltype,
            pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.conrelid = ANY($1::oid[]) AND c.contype IN ('p', 'u', 'f', 'c')`,
    [oids],
  );

  const indexRows = await client.query<IndexRow>(
    `SELECT i.indrelid::text AS indrelid, ic.relname AS index_name,
            (SELECT to_json(array_agg(a.attname::text ORDER BY k.ord))::text
               FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum WHERE k.attnum > 0) AS cols,
            (i.indpred IS NOT NULL) AS partial, (i.indexprs IS NOT NULL) AS has_expr,
            pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = ANY($1::oid[]) AND i.indisunique AND NOT i.indisprimary
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)`,
    [oids],
  );

  const tables = new Map<string, Table>();
  for (const t of tableRows.rows) {
    tables.set(t.oid, { schema: t.schema, name: t.name, columns: [], primaryKey: [], uniques: [], foreignKeys: [] });
  }

  const domainCheckList = new Map<string, string[]>();
  for (const d of domainChecks.rows) domainCheckList.set(d.name, [...(domainCheckList.get(d.name) ?? []), d.def]);

  for (const r of columnRows.rows) {
    const t = tables.get(r.attrelid);
    if (!t) continue;
    const isDomain = r.typtype === "d" && r.basetype;
    const type = parseType(isDomain ? (r.basetype as string) + (/\[\]$/.test(r.type) ? "[]" : "") : r.type, enums, t.schema);
    if (isDomain) type.domain = r.type.replace(/^.*\./, "").replace(/"/g, "");
    const col: Column = {
      name: r.attname,
      type,
      nullable: !bool(r.attnotnull) && !(isDomain && bool(r.domain_notnull)),
      hasDefault: bool(r.atthasdef) || r.attidentity !== "" || r.attgenerated !== "",
      serial: !!r.def && /^nextval\(/i.test(r.def),
      generated: r.attgenerated === "s",
    };
    if (r.def) col.default = r.def;
    if (r.attidentity === "a") col.identity = "always";
    else if (r.attidentity === "d") col.identity = "by-default";
    if (isDomain) {
      for (const def of domainCheckList.get(type.domain as string) ?? []) {
        const a = analyzeCheck(def, col.name);
        const found = a.columns.get(col.name);
        if (found) col.check = mergeCheck(col.check, found);
        if (!a.complete) warnings.push(`${t.name}.${col.name}: domain ${checkLabel(def)} is only partly understood, so generated values may violate it.`);
      }
    }
    t.columns.push(col);
  }

  for (const c of constraintRows.rows) {
    const t = tables.get(c.conrelid);
    if (!t) continue;
    const cols = arr(c.cols);
    if (c.contype === "p") {
      t.primaryKey = cols;
      for (const col of t.columns) if (cols.includes(col.name)) col.nullable = false;
    } else if (c.contype === "u") {
      t.uniques.push({ name: c.conname, columns: cols });
    } else if (c.contype === "f") {
      const fk: ForeignKey = {
        name: c.conname,
        columns: cols,
        refSchema: c.ref_schema ?? t.schema,
        refTable: c.ref_table ?? "",
        refColumns: arr(c.ref_cols),
        deferrable: bool(c.condeferrable),
      };
      const od = ON_DELETE[c.confdeltype];
      if (od) fk.onDelete = od;
      t.foreignKeys.push(fk);
    } else if (c.contype === "c") {
      const a = analyzeCheck(c.def);
      for (const [column, found] of a.columns) {
        const col = t.columns.find((x) => x.name === column);
        if (col) col.check = mergeCheck(col.check, found);
      }
      if (a.relations.length > 0) t.relations = [...(t.relations ?? []), ...a.relations];
      if (!a.complete) warnings.push(`${t.name}: ${checkLabel(c.def)} is only partly understood, so generated rows may violate it. A dry run will report it.`);
    }
  }

  for (const i of indexRows.rows) {
    const t = tables.get(i.indrelid);
    if (!t) continue;
    if (bool(i.has_expr)) {
      const m = /lower\(\(?"?([A-Za-z0-9_]+)"?(?:\)?::text)?\)\)?/i.exec(i.def);
      if (m && arr(i.cols).length === 0) {
        t.uniques.push({ name: i.index_name, columns: [m[1] as string], transform: "lower" } satisfies UniqueConstraint);
      } else {
        warnings.push(`Unique index ${i.index_name} on ${t.name} uses an expression that is not supported, so its uniqueness is not enforced.`);
      }
      continue;
    }
    t.uniques.push({ name: i.index_name, columns: arr(i.cols), ...(bool(i.partial) ? { partial: true } : {}) });
  }

  for (const t of tables.values()) {
    for (const col of t.columns) {
      if (col.type.kind === "unsupported") warnings.push(`${t.name}.${col.name}: type "${col.type.name}" is not supported; it is left to its default or NULL.`);
    }
  }
  return { tables: [...tables.values()], enums, warnings };
}

export interface TableEstimate {
  key: string;
  /** Planner estimate from pg_class.reltuples, -1 if the table was never analyzed. */
  rows: number;
}

/** Cheap row-count estimates (no table scans). */
export async function estimateRows(client: pg.Client, schemas: string[]): Promise<TableEstimate[]> {
  const r = await client.query<{ schema: string; name: string; reltuples: string }>(
    `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::text AS reltuples
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname = ANY($1::text[])`,
    [schemas],
  );
  return r.rows.map((x) => ({ key: `${x.schema}.${x.name}`, rows: Number(x.reltuples) }));
}

export async function listSchemas(client: pg.Client): Promise<string[]> {
  const r = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY nspname`,
  );
  return r.rows.map((x) => x.nspname);
}
