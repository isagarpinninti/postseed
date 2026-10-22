/**
 * Intermediate representation of a Postgres schema. Both sources (DDL text and a live
 * database) produce this shape, and everything downstream (planner, generators, writers)
 * consumes only this.
 */

export type TypeKind =
  | "smallint"
  | "int"
  | "bigint"
  | "numeric"
  | "float"
  | "money"
  | "text"
  | "varchar"
  | "char"
  | "bool"
  | "date"
  | "timestamp"
  | "timestamptz"
  | "time"
  | "timetz"
  | "interval"
  | "uuid"
  | "json"
  | "jsonb"
  | "inet"
  | "cidr"
  | "macaddr"
  | "bytea"
  | "bit"
  | "xml"
  | "enum"
  | "unsupported";

export interface PgType {
  kind: TypeKind;
  /** The type as written (lower-cased, without array brackets), e.g. `character varying`, `order_status`. */
  name: string;
  /** Array dimensions; 0 for a scalar. */
  array: number;
  /** Declared length for varchar(n) / char(n) / bit(n). */
  length?: number;
  precision?: number;
  scale?: number;
  /** Qualified enum name (`schema.name`) when `kind` is `enum`. */
  enumKey?: string;
  /** Name of the domain this column was declared with, if any. */
  domain?: string;
}

/** Value restrictions recovered from CHECK constraints (best effort). */
export interface ColumnCheck {
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  in?: Array<string | number | boolean>;
  minLen?: number;
  maxLen?: number;
}

export interface Column {
  name: string;
  type: PgType;
  nullable: boolean;
  /** True when the column has a DEFAULT expression, is serial, identity or generated. */
  hasDefault: boolean;
  default?: string;
  identity?: "always" | "by-default";
  /** `serial`, `bigserial`, or a `nextval(...)` default. */
  serial: boolean;
  /** GENERATED ALWAYS AS (...) STORED: never written. */
  generated: boolean;
  check?: ColumnCheck;
  /** First value of the sequence, when declared. */
  start?: number;
}

export interface UniqueConstraint {
  name?: string;
  columns: string[];
  /** `lower` when the index is on lower(column): values are compared case-insensitively. */
  transform?: "lower";
  /** A partial unique index; enforced everywhere, which is stricter than needed and always safe. */
  partial?: boolean;
}

export interface ForeignKey {
  name?: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  deferrable: boolean;
  onDelete?: string;
}

/** A CHECK that compares two columns of the same row, e.g. `ends_at >= starts_at` or `a <> b`. */
export interface ColumnRelation {
  left: string;
  op: ">" | ">=" | "<" | "<=" | "<>";
  right: string;
}

export interface Table {
  schema: string;
  name: string;
  columns: Column[];
  primaryKey: string[];
  uniques: UniqueConstraint[];
  foreignKeys: ForeignKey[];
  relations?: ColumnRelation[];
}

export interface EnumType {
  schema: string;
  name: string;
  values: string[];
}

export interface Database {
  tables: Table[];
  enums: EnumType[];
  /** Notes about constructs that were skipped or approximated. Never fatal. */
  warnings: string[];
}

export const tableKey = (t: { schema: string; name: string }): string => `${t.schema}.${t.name}`;

export const findTable = (db: Database, schema: string, name: string): Table | undefined =>
  db.tables.find((t) => t.schema === schema && t.name === name);

export function getTable(db: Database, key: string): Table {
  const t = db.tables.find((x) => tableKey(x) === key);
  if (!t) throw new Error(`Unknown table "${key}"`);
  return t;
}

export const getColumn = (t: Table, name: string): Column => {
  const c = t.columns.find((x) => x.name === name);
  if (!c) throw new Error(`Unknown column "${t.name}.${name}"`);
  return c;
};

/** A table's keys are matched ignoring the schema when the name is unambiguous. */
export function resolveTableKey(db: Database, ref: string): string | undefined {
  if (db.tables.some((t) => tableKey(t) === ref)) return ref;
  const matches = db.tables.filter((t) => t.name === ref);
  return matches.length === 1 && matches[0] ? tableKey(matches[0]) : undefined;
}
