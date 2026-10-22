import type { EnumType, PgType, TypeKind } from "./ir";

const KINDS: Record<string, TypeKind> = {
  smallint: "smallint",
  int2: "smallint",
  smallserial: "smallint",
  serial2: "smallint",
  int: "int",
  int4: "int",
  integer: "int",
  serial: "int",
  serial4: "int",
  bigint: "bigint",
  int8: "bigint",
  bigserial: "bigint",
  serial8: "bigint",
  numeric: "numeric",
  decimal: "numeric",
  real: "float",
  float4: "float",
  "double precision": "float",
  float8: "float",
  float: "float",
  money: "money",
  text: "text",
  citext: "text",
  name: "text",
  varchar: "varchar",
  "character varying": "varchar",
  char: "char",
  bpchar: "char",
  character: "char",
  bool: "bool",
  boolean: "bool",
  date: "date",
  timestamp: "timestamp",
  "timestamp without time zone": "timestamp",
  timestamptz: "timestamptz",
  "timestamp with time zone": "timestamptz",
  time: "time",
  "time without time zone": "time",
  timetz: "timetz",
  "time with time zone": "timetz",
  interval: "interval",
  uuid: "uuid",
  json: "json",
  jsonb: "jsonb",
  inet: "inet",
  cidr: "cidr",
  macaddr: "macaddr",
  macaddr8: "macaddr",
  bytea: "bytea",
  bit: "bit",
  varbit: "bit",
  "bit varying": "bit",
  xml: "xml",
};

const SERIAL = new Set(["smallserial", "serial2", "serial", "serial4", "bigserial", "serial8"]);

export const isSerialTypeName = (name: string): boolean => SERIAL.has(name.toLowerCase());

const stripQuotes = (s: string): string => s.replace(/"/g, "");

/** Splits `schema.name` and applies the default schema. */
export function splitQualified(name: string, defaultSchema = "public"): { schema: string; name: string } {
  const parts = stripQuotes(name).split(".");
  return parts.length >= 2
    ? { schema: parts[parts.length - 2] as string, name: parts[parts.length - 1] as string }
    : { schema: defaultSchema, name: parts[0] as string };
}

/**
 * Parses a type as Postgres prints it (`character varying(20)`, `numeric(10,2)`, `text[]`,
 * `public.order_status`) or as DDL writes it, and classifies it.
 */
export function parseType(input: string, enums: readonly EnumType[], defaultSchema = "public"): PgType {
  let text = input.trim().replace(/\s+/g, " ");
  let array = 0;
  for (;;) {
    const m = /\[\d*\]$/.exec(text);
    if (!m) break;
    array++;
    text = text.slice(0, m.index).trim();
  }
  if (/^array\b/i.test(text)) array = Math.max(array, 1);
  let params: number[] = [];
  const pm = /\(([^)]*)\)/.exec(text);
  if (pm) {
    params = (pm[1] ?? "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n));
    text = (text.slice(0, pm.index) + text.slice(pm.index + pm[0].length)).replace(/\s+/g, " ").trim();
  }
  const bare = stripQuotes(text).toLowerCase();
  const withoutSchema = bare.startsWith("pg_catalog.") ? bare.slice("pg_catalog.".length) : bare;
  const kind = KINDS[withoutSchema];
  const type: PgType = { kind: kind ?? "unsupported", name: withoutSchema, array };
  if (kind) {
    if (kind === "varchar" || kind === "char" || kind === "bit") {
      if (params[0] !== undefined) type.length = params[0];
      // A bare `char` is char(1), but a bare `bpchar` is the unbounded blank-padded type.
      else if (kind === "char" && withoutSchema !== "bpchar") type.length = 1;
    } else if (kind === "numeric") {
      if (params[0] !== undefined) type.precision = params[0];
      if (params[1] !== undefined) type.scale = params[1];
      else if (params[0] !== undefined) type.scale = 0;
    }
    return type;
  }
  const q = splitQualified(text, defaultSchema);
  const candidates = enums.filter((e) => e.name.toLowerCase() === q.name.toLowerCase());
  const exact = candidates.find((e) => e.schema === q.schema) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (exact) return { kind: "enum", name: exact.name, array, enumKey: `${exact.schema}.${exact.name}` };
  return type;
}

export const isTextual = (k: TypeKind): boolean => k === "text" || k === "varchar" || k === "char";
export const isIntegral = (k: TypeKind): boolean => k === "smallint" || k === "int" || k === "bigint";
export const isNumeric = (k: TypeKind): boolean =>
  isIntegral(k) || k === "numeric" || k === "float" || k === "money";
export const isTemporal = (k: TypeKind): boolean =>
  k === "date" || k === "timestamp" || k === "timestamptz" || k === "time" || k === "timetz";
