import { DAY, DEFAULT_NOW, fakerFn, type Env, type Gen } from "./env";
import { boolProbability, heuristicApplies, jsonGenerator, rangeFor, textGenerator, timeWindow } from "./heuristics";
import type { Column, ColumnCheck, EnumType, Table } from "./ir";
import { isIntegral, isTextual } from "./types";
import type { Value } from "./value";

/** How a column's non-null values are produced, when no override or relationship decides it. */

export class PostseedError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNKNOWN_TABLE"
      | "MISSING_PARENT"
      | "CYCLE"
      | "UNIQUE_EXHAUSTED"
      | "BAD_OVERRIDE"
      | "NO_ROWS"
      | "UNSUPPORTED",
  ) {
    super(message);
    this.name = "PostseedError";
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

function parts(ms: number): { y: string; mo: string; d: string; h: string; mi: string; s: string } {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  return {
    y: pad(d.getUTCFullYear(), 4),
    mo: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    h: pad(d.getUTCHours()),
    mi: pad(d.getUTCMinutes()),
    s: pad(d.getUTCSeconds()),
  };
}

export function formatTemporal(kind: Column["type"]["kind"], ms: number): string {
  const p = parts(ms);
  switch (kind) {
    case "date":
      return `${p.y}-${p.mo}-${p.d}`;
    case "timestamp":
      return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`;
    case "time":
      return `${p.h}:${p.mi}:${p.s}`;
    case "timetz":
      return `${p.h}:${p.mi}:${p.s}+00`;
    default:
      return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}+00`;
  }
}

const POW10 = (n: number): number => 10 ** n;

/** Numeric bounds for a column: type limits, then CHECKs, then the name heuristic (only where it fits). */
export function numericBounds(col: Column): { lo: number; hi: number; scale: number } {
  const k = col.type.kind;
  let scale = 0;
  let lo = 0;
  let hi = 100000;
  let typeMax = Number.MAX_SAFE_INTEGER;
  if (k === "smallint") {
    hi = 1000;
    typeMax = 32767;
  } else if (k === "int") {
    hi = 100000;
    typeMax = 2147483647;
  } else if (k === "bigint") {
    hi = 10_000_000;
  } else if (k === "numeric" || k === "money") {
    scale = col.type.scale ?? 2;
    hi = 10000;
    if (col.type.precision !== undefined) typeMax = POW10(col.type.precision - (col.type.scale ?? 0)) - POW10(-scale);
  } else if (k === "float") {
    scale = 2;
    hi = 10000;
  }
  const h = rangeFor(col);
  if (h) {
    lo = h[0];
    hi = h[1];
  }
  const c = col.check;
  const step = scale > 0 ? POW10(-scale) : 1;
  let cLo = -Infinity;
  let cHi = Infinity;
  if (c?.min !== undefined) cLo = c.minExclusive ? c.min + step : c.min;
  if (c?.max !== undefined) cHi = c.maxExclusive ? c.max - step : c.max;
  // The heuristic range only narrows; if it does not overlap the CHECK, the CHECK wins.
  if (cLo > hi || cHi < lo) {
    lo = Number.isFinite(cLo) ? cLo : Math.min(lo, cHi);
    hi = Number.isFinite(cHi) ? cHi : lo + 1000;
  } else {
    lo = Math.max(lo, cLo);
    hi = Math.min(hi, cHi);
  }
  hi = Math.min(hi, typeMax);
  lo = Math.max(lo, -typeMax);
  if (lo > hi) lo = hi;
  if (scale === 0) {
    lo = Math.ceil(lo);
    hi = Math.floor(hi);
  }
  return { lo, hi, scale };
}

function numberGen(env: Env, col: Column, tableForceUniqueSpan?: number): Gen {
  const b = numericBounds(col);
  const k = col.type.kind;
  const rng = env.rng;
  const { lo } = b;
  let { hi } = b;
  if (tableForceUniqueSpan && col.check?.max === undefined && isIntegral(k)) hi = Math.max(hi, lo + tableForceUniqueSpan);
  if (isIntegral(k)) return () => rng.int(lo, hi);
  const scale = b.scale;
  const factor = POW10(scale);
  if (k === "float") return () => Math.round((lo + rng.float() * (hi - lo)) * factor) / factor;
  // numeric / money: exact decimal text so no float noise reaches the database.
  const loI = Math.ceil(lo * factor - 1e-9);
  const hiI = Math.floor(hi * factor + 1e-9);
  return () => {
    const v = rng.int(loI, Math.max(loI, hiI));
    if (scale === 0) return String(v);
    const neg = v < 0 ? "-" : "";
    const abs = String(Math.abs(v)).padStart(scale + 1, "0");
    return `${neg}${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
  };
}

export function fitText(s: string, col: Column): string {
  const max = Math.min(col.type.length ?? Infinity, col.check?.maxLen ?? Infinity);
  let out = s;
  const min = col.check?.minLen ?? 0;
  while (out.length < min) out += s || "x";
  if (Number.isFinite(max) && out.length > max) out = out.slice(0, Math.max(0, max));
  return out;
}

function textGen(env: Env, col: Column): Gen {
  const factory = textGenerator(env.table, col);
  const rng = env.rng;
  const maxLen = Math.min(col.type.length ?? Infinity, col.check?.maxLen ?? Infinity);
  if (factory) {
    const g = factory(env);
    return (i) => fitText(String(g(i)), col);
  }
  if (maxLen <= 12) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    return () => {
      const len = Math.min(maxLen, rng.int(Math.min(3, maxLen), maxLen));
      let s = "";
      for (let i = 0; i < len; i++) s += alphabet[rng.int(0, 25)];
      return fitText(s, col);
    };
  }
  const words = fakerFn(env.faker, "word.words");
  return () => {
    const s = String(words({ count: { min: 1, max: 4 } }));
    return fitText(s.charAt(0).toUpperCase() + s.slice(1), col);
  };
}

function enumGen(env: Env, values: readonly string[]): Gen {
  const rng = env.rng;
  return () => rng.pick(values);
}

function timeGen(env: Env, col: Column): Gen {
  const [from, to] = timeWindow(col);
  const rng = env.rng;
  const k = col.type.kind;
  const start = env.now + from;
  const end = env.now + to;
  if (k === "time" || k === "timetz") return () => formatTemporal(k, rng.int(0, DAY - 1000));
  return () => formatTemporal(k, rng.int(Math.floor(start / 1000), Math.floor(end / 1000)) * 1000);
}

function scalarGen(env: Env, col: Column, enums: readonly EnumType[], uniqueSpan?: number): Gen | undefined {
  const k = col.type.kind;
  const rng = env.rng;
  const inList = col.check?.in;
  if (inList && inList.length > 0 && k !== "enum") return () => rng.pick(inList);
  switch (k) {
    case "smallint":
    case "int":
    case "bigint":
    case "numeric":
    case "float":
    case "money":
      return numberGen(env, col, uniqueSpan);
    case "text":
    case "varchar":
    case "char":
      return textGen(env, col);
    case "bool": {
      const p = boolProbability(col);
      return () => rng.bool(p);
    }
    case "date":
    case "timestamp":
    case "timestamptz":
    case "time":
    case "timetz":
      return timeGen(env, col);
    case "uuid":
      return () => rng.uuid();
    case "json":
    case "jsonb":
      return jsonGenerator(col)(env);
    case "inet":
      return () => `${rng.int(11, 223)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
    case "cidr":
      return () => `${rng.int(11, 223)}.${rng.int(0, 255)}.${rng.int(0, 255)}.0/24`;
    case "macaddr":
      return () => Array.from({ length: 6 }, () => rng.int(0, 255).toString(16).padStart(2, "0")).join(":");
    case "bytea":
      return () => `\\x${Array.from({ length: rng.int(8, 16) }, () => rng.int(0, 255).toString(16).padStart(2, "0")).join("")}`;
    case "bit":
      return () => Array.from({ length: col.type.length ?? 8 }, () => (rng.bool() ? "1" : "0")).join("");
    case "interval":
      return () => `${rng.int(1, 30)} ${rng.pick(["days", "hours", "minutes"])}`;
    case "xml": {
      const w = fakerFn(env.faker, "word.noun");
      return () => `<note>${String(w())}</note>`;
    }
    case "enum": {
      const e = enums.find((x) => `${x.schema}.${x.name}` === col.type.enumKey);
      if (!e || e.values.length === 0) return undefined;
      return enumGen(env, e.values);
    }
    default:
      return undefined;
  }
}

/** The default generator for a column: element-wise for arrays. `undefined` means the type is unsupported. */
export function defaultGen(env: Env, col: Column, enums: readonly EnumType[], uniqueSpan?: number): Gen | undefined {
  if (col.type.array > 0) {
    const elem = scalarGen(env, { ...col, type: { ...col.type, array: 0 } }, enums);
    if (!elem) return undefined;
    const rng = env.rng;
    const dims = col.type.array;
    return (i) => {
      const n = rng.int(1, 4);
      if (dims === 1) return Array.from({ length: n }, () => elem(i));
      return Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => elem(i)));
    };
  }
  return scalarGen(env, col, enums, uniqueSpan);
}

/** How many distinct values the column can hold, if that is knowable (used to fail early on UNIQUE). */
export function domainSize(col: Column, enums: readonly EnumType[]): number {
  if (col.type.array > 0) return Infinity;
  const check: ColumnCheck | undefined = col.check;
  if (check?.in) return new Set(check.in.map(String)).size;
  switch (col.type.kind) {
    case "bool":
      return 2;
    case "enum":
      return enums.find((x) => `${x.schema}.${x.name}` === col.type.enumKey)?.values.length ?? Infinity;
    case "smallint":
    case "int":
    case "bigint": {
      const b = numericBounds(col);
      return check?.max !== undefined || check?.min !== undefined ? Math.max(0, b.hi - b.lo + 1) : Infinity;
    }
    case "char":
    case "varchar":
      return col.type.length !== undefined && col.type.length <= 2 ? 26 ** col.type.length : Infinity;
    default:
      return Infinity;
  }
}

export const generatesText = (col: Column): boolean => isTextual(col.type.kind) && col.type.array === 0;
export const hasHeuristic = (col: Column): boolean => heuristicApplies(col) !== undefined;
export const defaultNow = DEFAULT_NOW;
export type { Table, Value };

/** Milliseconds since the epoch for a value `formatTemporal` produced. */
function temporalMs(kind: Column["type"]["kind"], v: string): number {
  if (kind === "date") return Date.parse(`${v}T00:00:00Z`);
  if (kind === "time" || kind === "timetz") return Date.parse(`1970-01-01T${v.replace(/\+00$/, "")}Z`);
  return Date.parse(`${v.replace(" ", "T").replace(/\+00$/, "")}Z`);
}

const numberOf = (v: Value, _col: Column): number => (typeof v === "number" ? v : Number(v) || 0);

/** Orders two values of the same column type: negative, zero or positive. */
export function compareValues(a: Value, b: Value, col: Column): number {
  const k = col.type.kind;
  if (k === "smallint" || k === "int" || k === "bigint" || k === "float" || k === "numeric" || k === "money") return numberOf(a, col) - numberOf(b, col);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The next value up or down from `v` for the column's type (one unit: 1, one scale step, a day, a second). */
export function bumpValue(v: Value, col: Column, up: boolean): Value {
  const k = col.type.kind;
  const sign = up ? 1 : -1;
  if (k === "smallint" || k === "int" || k === "bigint") return numberOf(v, col) + sign;
  if (k === "float" || k === "numeric" || k === "money") {
    const scale = k === "float" ? 2 : col.type.scale ?? 2;
    const next = numberOf(v, col) + sign * 10 ** -scale;
    return k === "float" ? Math.round(next * 10 ** scale) / 10 ** scale : next.toFixed(scale);
  }
  if (k === "date" || k === "timestamp" || k === "timestamptz" || k === "time" || k === "timetz") {
    const ms = temporalMs(k, String(v));
    return Number.isFinite(ms) ? formatTemporal(k, ms + sign * (k === "date" ? DAY : 1000)) : v;
  }
  return `${String(v)}${up ? "x" : ""}`;
}
