import { parse, type Expr } from "pgsql-ast-parser";
import type { ColumnCheck, ColumnRelation } from "./ir";

/** Best-effort extraction of per-column value restrictions from a CHECK expression. */

type Lit = string | number | boolean;

function literal(e: Expr): Lit | undefined {
  switch (e.type) {
    case "integer":
    case "numeric":
      return e.value;
    case "string":
      return e.value;
    case "boolean":
      return e.value;
    case "cast":
      return literal(e.operand);
    case "unary":
      if (e.op === "-") {
        const v = literal(e.operand);
        return typeof v === "number" ? -v : undefined;
      }
      if (e.op === "+") return literal(e.operand);
      return undefined;
    default:
      return undefined;
  }
}

/** The column a side of a comparison refers to, looking through casts; `len` for char_length(col). */
function side(e: Expr): { column: string; len: boolean } | undefined {
  switch (e.type) {
    case "ref":
      return e.name === "*" ? undefined : { column: e.name, len: false };
    case "cast":
      return side(e.operand);
    case "call": {
      const fn = e.function.name.toLowerCase();
      if ((fn === "char_length" || fn === "length" || fn === "character_length") && e.args.length === 1) {
        const inner = side(e.args[0] as Expr);
        return inner ? { column: inner.column, len: true } : undefined;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function listOf(e: Expr): Lit[] | undefined {
  if (e.type === "cast") return listOf(e.operand);
  if (e.type === "list" || e.type === "array") {
    const out: Lit[] = [];
    for (const x of e.expressions) {
      const v = literal(x);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (e.type === "call" && e.function.name.toLowerCase() === "any" && e.args.length === 1) {
    return listOf(e.args[0] as Expr);
  }
  return undefined;
}

type Acc = Map<string, ColumnCheck>;

const slot = (acc: Acc, column: string): ColumnCheck => {
  let c = acc.get(column);
  if (!c) {
    c = {};
    acc.set(column, c);
  }
  return c;
};

function bound(c: ColumnCheck, op: ">" | ">=" | "<" | "<=", n: number, len: boolean): void {
  if (len) {
    if (op === ">") c.minLen = Math.max(c.minLen ?? 0, Math.floor(n) + 1);
    else if (op === ">=") c.minLen = Math.max(c.minLen ?? 0, Math.ceil(n));
    else if (op === "<") c.maxLen = Math.min(c.maxLen ?? Infinity, Math.ceil(n) - 1);
    else c.maxLen = Math.min(c.maxLen ?? Infinity, Math.floor(n));
    return;
  }
  if (op === ">" || op === ">=") {
    if (c.min === undefined || n > c.min || (n === c.min && op === ">")) {
      c.min = n;
      c.minExclusive = op === ">";
    }
  } else if (c.max === undefined || n < c.max || (n === c.max && op === "<")) {
    c.max = n;
    c.maxExclusive = op === "<";
  }
}

const FLIP: Record<string, ">" | ">=" | "<" | "<="> = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" };

interface Acc2 {
  columns: Acc;
  relations: ColumnRelation[];
}

/** Returns true when the whole expression was understood (so nothing is left for the dry run to catch). */
function visit(e: Expr, acc: Acc2): boolean {
  if (e.type === "binary") {
    const op = e.op as string;
    if (op === "AND") {
      const l = visit(e.left, acc);
      const r = visit(e.right, acc);
      return l && r;
    }
    if (op === ">" || op === ">=" || op === "<" || op === "<=") {
      const l = side(e.left);
      const rv = literal(e.right);
      if (l && typeof rv === "number") {
        bound(slot(acc.columns, l.column), op, rv, l.len);
        return true;
      }
      const r = side(e.right);
      const lv = literal(e.left);
      if (r && typeof lv === "number") {
        bound(slot(acc.columns, r.column), FLIP[op] as ">", lv, r.len);
        return true;
      }
      if (l && r && !l.len && !r.len && l.column !== r.column) {
        acc.relations.push({ left: l.column, op, right: r.column });
        return true;
      }
      return false;
    }
    if (op === "<>" || op === "!=") {
      const l = side(e.left);
      const r = side(e.right);
      if (l && r && !l.len && !r.len && l.column !== r.column) {
        acc.relations.push({ left: l.column, op: "<>", right: r.column });
        return true;
      }
      return false;
    }
    if (op === "=") {
      const l = side(e.left);
      const rv = literal(e.right);
      if (l && !l.len && rv !== undefined) {
        slot(acc.columns, l.column).in = [rv];
        return true;
      }
      if (l && !l.len) {
        const list = listOf(e.right);
        if (list) {
          slot(acc.columns, l.column).in = list;
          return true;
        }
      } else if (l?.len && typeof rv === "number") {
        const c = slot(acc.columns, l.column);
        c.minLen = rv;
        c.maxLen = rv;
        return true;
      }
      return false;
    }
    if (op === "IN") {
      const l = side(e.left);
      const list = listOf(e.right);
      if (l && !l.len && list) {
        slot(acc.columns, l.column).in = list;
        return true;
      }
    }
    return false;
  }
  if (e.type === "ternary" && e.op === "BETWEEN") {
    const l = side(e.value);
    const lo = literal(e.lo);
    const hi = literal(e.hi);
    if (l && typeof lo === "number" && typeof hi === "number") {
      bound(slot(acc.columns, l.column), ">=", lo, l.len);
      bound(slot(acc.columns, l.column), "<=", hi, l.len);
      return true;
    }
    return false;
  }
  if (e.type === "unary" && (e.op as string) === "IS NOT NULL") return side(e.operand) !== undefined;
  return false;
}

export interface CheckAnalysis {
  columns: Map<string, ColumnCheck>;
  relations: ColumnRelation[];
  /** False when part of the expression is beyond what the generator enforces (the dry run is the validator). */
  complete: boolean;
}

/**
 * Reads the text of a CHECK expression (as written in DDL or printed by `pg_get_constraintdef`).
 * `VALUE` stands for the column in a domain check.
 */
export function analyzeCheck(exprText: string, domainColumn?: string): CheckAnalysis {
  const acc: Acc2 = { columns: new Map(), relations: [] };
  let text = exprText.trim();
  text = text.replace(/^check\s*/i, "").replace(/\s+(not valid|no inherit)\s*$/gi, "");
  let complete = false;
  try {
    if (domainColumn) text = text.replace(/\bVALUE\b/g, `"${domainColumn}"`);
    const first = parse(`SELECT 1 WHERE ${text}`)[0];
    if (first && first.type === "select" && first.where) complete = visit(first.where, acc);
  } catch {
    complete = false;
  }
  return { columns: acc.columns, relations: acc.relations, complete };
}

/** A short, one-line form of a CHECK for messages. */
export function checkLabel(exprText: string): string {
  let t = exprText.trim().replace(/^check\s*/i, "").replace(/\s+/g, " ");
  // Printed expressions are fully parenthesised; drop the parentheses around plain numbers and doubled ones.
  t = t.replace(/\((-?\d+(?:\.\d+)?)\)/g, "$1");
  for (let i = 0; i < 4; i++) t = t.replace(/\(\(([^()]*)\)\)/g, "($1)");
  return `CHECK ${t.length > 90 ? `${t.slice(0, 87)}...` : t}`;
}

/** Per-column restrictions only (see analyzeCheck for relations and completeness). */
export function extractChecks(exprText: string, domainColumn?: string): Map<string, ColumnCheck> {
  return analyzeCheck(exprText, domainColumn).columns;
}

export function mergeCheck(into: ColumnCheck | undefined, add: ColumnCheck): ColumnCheck {
  const out: ColumnCheck = { ...(into ?? {}) };
  if (add.min !== undefined) bound(out, add.minExclusive ? ">" : ">=", add.min, false);
  if (add.max !== undefined) bound(out, add.maxExclusive ? "<" : "<=", add.max, false);
  if (add.minLen !== undefined) out.minLen = Math.max(out.minLen ?? 0, add.minLen);
  if (add.maxLen !== undefined) out.maxLen = Math.min(out.maxLen ?? Infinity, add.maxLen);
  if (add.in) out.in = add.in;
  return out;
}
