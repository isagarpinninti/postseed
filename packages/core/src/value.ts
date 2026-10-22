import type { Column } from "./ir";

/** A generated cell. JSON columns hold plain objects, array columns hold arrays. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

const NUMERIC = /^-?\d+(\.\d+)?$/;

const stripNul = (s: string): string => (s.includes("\u0000") ? s.replace(/\u0000/g, "") : s);

/** Quotes a string as a SQL literal. Backslashes use the E'' form, which is correct under any `standard_conforming_strings`. */
export function quoteString(s: string): string {
  const clean = stripNul(s);
  if (clean.includes("\\")) return `E'${clean.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  return `'${clean.replace(/'/g, "''")}'`;
}

/** Quotes an identifier, only when it needs it. */
export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export const qualified = (schema: string, name: string): string => `${quoteIdent(schema)}.${quoteIdent(name)}`;

/** The element text inside a Postgres array literal. */
function arrayElement(v: Value): string {
  if (v === null) return "NULL";
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") return String(v);
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return `"${stripNul(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function arrayLiteral(items: readonly Value[]): string {
  return `{${items.map(arrayElement).join(",")}}`;
}

/**
 * The textual form Postgres itself would print for the value: this is what CSV, COPY and
 * (quoted) SQL literals all start from.
 */
export function valueToText(v: Value): string {
  if (v === null) return "";
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === "boolean") return v ? "t" : "f";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "object") return JSON.stringify(v);
  return stripNul(v);
}

/** SQL literal for an INSERT/UPDATE value. */
export function sqlLiteral(v: Value, column: Column): string {
  if (v === null) return "NULL";
  if (column.type.array > 0 && Array.isArray(v)) return quoteString(arrayLiteral(v));
  switch (typeof v) {
    case "boolean":
      return v ? "TRUE" : "FALSE";
    case "number":
      return Number.isFinite(v) ? String(v) : "NULL";
    case "string": {
      if ((column.type.kind === "numeric" || column.type.kind === "money") && NUMERIC.test(v)) return v;
      return quoteString(v);
    }
    default:
      return quoteString(JSON.stringify(v));
  }
}

/** COPY ... FROM STDIN (text format) cell. */
export function copyText(v: Value): string {
  if (v === null) return "\\N";
  return valueToText(v).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** CSV cell in the dialect `COPY ... CSV` reads: NULL is an unquoted empty field, '' is `""`. */
export function csvCell(v: Value): string {
  if (v === null) return "";
  const s = valueToText(v);
  if (s === "" || /[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** JSON-friendly form: numerics become numbers when that loses nothing, everything else is kept. */
export function jsonValue(v: Value, column: Column): Value {
  if (v === null) return null;
  if ((column.type.kind === "numeric" || column.type.kind === "money") && typeof v === "string" && NUMERIC.test(v)) {
    const n = Number(v);
    const canonical = v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
    return String(n) === canonical.replace(/^-0$/, "0") || String(n) === canonical ? n : v;
  }
  return v;
}
