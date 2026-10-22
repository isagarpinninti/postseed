import { parse, toSql, type Statement, type DataTypeDef, type Expr } from "pgsql-ast-parser";
import { analyzeCheck, checkLabel, mergeCheck } from "./checks";
import type { Column, ColumnCheck, Database, EnumType, ForeignKey, Table } from "./ir";
import { isSerialTypeName, parseType, splitQualified } from "./types";

/* ───────────────────────── statement splitting ───────────────────────── */

/** Splits a SQL script into statements, ignoring `;` inside strings, quoted identifiers, dollar quotes and comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const flush = (): void => {
    const s = cur.trim();
    cur = "";
    if (!s) return;
    out.push(s);
    // pg_dump `COPY ... FROM stdin;` is followed by raw data lines up to `\.`.
    if (/^copy\b[\s\S]*\bfrom\s+stdin\b/i.test(s)) {
      const end = sql.indexOf("\n\\.", i);
      i = end === -1 ? n : end + 3;
    }
  };
  while (i < n) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      cur += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      cur += " ";
      continue;
    }
    if (ch === "'") {
      const escape = /e$/i.test(cur) && !/[\w]e$/i.test(cur);
      cur += ch;
      i++;
      while (i < n) {
        const c = sql[i] as string;
        cur += c;
        i++;
        if (escape && c === "\\" && i < n) {
          cur += sql[i] as string;
          i++;
        } else if (c === "'") {
          if (sql[i] === "'") {
            cur += "'";
            i++;
          } else break;
        }
      }
      continue;
    }
    if (ch === '"') {
      cur += ch;
      i++;
      while (i < n) {
        const c = sql[i] as string;
        cur += c;
        i++;
        if (c === '"') {
          if (sql[i] === '"') {
            cur += '"';
            i++;
          } else break;
        }
      }
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      i++;
      flush();
      continue;
    }
    cur += ch;
    i++;
  }
  flush();
  return out;
}

/** Index of the parenthesis closing the one at `open`, or -1. Quote-aware. */
function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < s.length && !(s[i] === q && s[i + 1] !== q)) i += s[i] === q ? 2 : 1;
    } else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < s.length && !(s[i] === q && s[i + 1] !== q)) i += s[i] === q ? 2 : 1;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/* ───────────────────────── helpers ───────────────────────── */

const PK_PLACEHOLDER = "__postseed_pk__";

const ident = (n: { name: string }): string => n.name;

/** Column list of a REFERENCES clause; the placeholder (an omitted list) becomes empty. */
const refList = (cols: Array<{ name: string }> | undefined): string[] => {
  const names = cols?.map((c) => c.name) ?? [];
  return names.length === 1 && names[0] === PK_PLACEHOLDER ? [] : names;
};

function typeText(dt: DataTypeDef): string {
  if (dt.kind === "array") return `${typeText(dt.arrayOf)}[]`;
  const cfg = dt.config && dt.config.length ? `(${dt.config.join(",")})` : "";
  const schema = "schema" in dt && typeof dt.schema === "string" ? `${dt.schema}.` : "";
  return `${schema}${dt.name}${cfg}`;
}

interface Hint {
  deferrable?: boolean;
  start?: number;
}

/** Strips DEFERRABLE clauses (the parser rejects them) and remembers them per constraint. */
function normaliseTableBody(parts: string[]): { parts: string[]; hints: Map<string, Hint> } {
  const hints = new Map<string, Hint>();
  const cleaned = parts.map((part) => {
    let p = part;
    let deferrable: boolean | undefined;
    if (/\bnot\s+deferrable\b/i.test(p)) {
      deferrable = false;
      p = p.replace(/\s+not\s+deferrable\b(\s+initially\s+(deferred|immediate))?/gi, "");
    }
    if (/\bdeferrable\b/i.test(p)) {
      deferrable = true;
      p = p.replace(/\s+deferrable\b(\s+initially\s+(deferred|immediate))?/gi, "");
    }
    p = p.replace(/\s+initially\s+(deferred|immediate)\b/gi, "");
    const fk = /foreign\s+key\s*\(([^)]*)\)/i.exec(p);
    const key = fk ? `fk:${columnList(fk[1] ?? "").join(",")}` : `col:${firstIdent(p)}`;
    const start = /start\s+(?:with\s+)?(\d+)/i.exec(p);
    if (deferrable !== undefined || start) {
      hints.set(key, { ...(deferrable !== undefined ? { deferrable } : {}), ...(start ? { start: Number(start[1]) } : {}) });
    }
    // `REFERENCES parent` with no column list means the parent's primary key; the parser needs a list, so give it a
    // placeholder that is resolved once every table is known.
    p = p.replace(/\breferences\s+((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))?)(?!\s*[(\w."$])/gi, `references $1 (${PK_PLACEHOLDER})`);
    // Sequence options inside IDENTITY ( ... ) are not understood by the parser.
    p = p.replace(/(as\s+identity)\s*\([^)]*\)/gi, "$1");
    return p;
  });
  return { parts: cleaned, hints };
}

const columnList = (s: string): string[] => s.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));

function firstIdent(p: string): string {
  const m = /^\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))/.exec(p);
  return m ? (m[1] ?? m[2] ?? "").replace(/""/g, '"') : "";
}

function exprText(e: Expr): string {
  try {
    return toSql.expr(e);
  } catch {
    return "";
  }
}

/* ───────────────────────── builder ───────────────────────── */

interface DomainDef {
  base: string;
  notNull: boolean;
  checks: string[];
}

class Builder {
  readonly enums: EnumType[] = [];
  readonly domains = new Map<string, DomainDef>();
  readonly tables: Table[] = [];
  readonly warnings: string[] = [];

  private warn(msg: string): void {
    this.warnings.push(msg);
  }

  /** Folds a CHECK into the table: per-column limits, column-vs-column relations, and a warning if anything is left over. */
  private applyCheck(t: Table, text: string): void {
    const a = analyzeCheck(text);
    for (const [column, found] of a.columns) {
      const col = t.columns.find((x) => x.name === column);
      if (col) col.check = mergeCheck(col.check, found);
    }
    if (a.relations.length > 0) t.relations = [...(t.relations ?? []), ...a.relations];
    if (!a.complete) this.warn(`${t.name}: ${checkLabel(text)} is only partly understood, so generated rows may violate it. A dry run will report it.`);
  }

  findTable(schema: string, name: string): Table | undefined {
    return this.tables.find((t) => t.schema === schema && t.name === name);
  }

  addEnum(schema: string, name: string, values: string[]): void {
    if (!this.enums.some((e) => e.schema === schema && e.name === name)) this.enums.push({ schema, name, values });
  }

  addDomain(statement: string): void {
    const m = /^create\s+domain\s+((?:"[^"]+"|[\w$.]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s+(?:as\s+)?([\s\S]+)$/i.exec(statement);
    if (!m) return this.warn(`Skipped a CREATE DOMAIN that could not be read: ${statement.slice(0, 60)}`);
    const rest = (m[2] ?? "").trim();
    const stop = /\s+(default|not\s+null|null|check|constraint|collate)\b/i.exec(rest);
    const base = (stop ? rest.slice(0, stop.index) : rest).trim();
    const checks: string[] = [];
    const re = /check\s*\(/gi;
    for (let cm = re.exec(rest); cm; cm = re.exec(rest)) {
      const open = rest.indexOf("(", cm.index);
      const close = matching(rest, open);
      if (close > open) checks.push(rest.slice(open + 1, close));
    }
    this.domains.set(splitQualified(m[1] ?? "").name.toLowerCase(), {
      base,
      notNull: /\bnot\s+null\b/i.test(rest),
      checks,
    });
  }

  private buildColumn(
    tableName: string,
    def: { name: { name: string }; dataType: DataTypeDef; constraints?: unknown[] },
    t: Table,
    hint: Hint | undefined,
    schema: string,
  ): void {
    const name = ident(def.name);
    const rawType = typeText(def.dataType);
    const base = splitQualified(rawType.replace(/\[\]$/, ""), schema);
    const dom = this.domains.get(base.name.toLowerCase());
    let type = parseType(dom ? dom.base + (/\[\]$/.test(rawType) ? "[]" : "") : rawType, this.enums, schema);
    if (dom) type = { ...type, domain: base.name };
    const serial = isSerialTypeName(rawType);
    const col: Column = {
      name,
      type,
      nullable: dom ? !dom.notNull : true,
      hasDefault: serial,
      serial,
      generated: false,
    };
    if (hint?.start !== undefined) col.start = hint.start;
    let check: ColumnCheck | undefined;
    const ownChecks: string[] = [];
    if (dom) {
      for (const c of dom.checks) {
        const a = analyzeCheck(c, name);
        check = mergeCheck(check, a.columns.get(name) ?? {});
        if (!a.complete) this.warn(`${tableName}.${name}: domain ${checkLabel(c)} is only partly understood, so generated values may violate it.`);
      }
    }
    for (const raw of def.constraints ?? []) {
      const c = raw as Record<string, unknown> & { type: string };
      switch (c.type) {
        case "not null":
          col.nullable = false;
          break;
        case "null":
          col.nullable = true;
          break;
        case "default": {
          col.hasDefault = true;
          const e = c.default as Expr;
          col.default = exprText(e);
          if (e.type === "call" && e.function.name.toLowerCase() === "nextval") col.serial = true;
          break;
        }
        case "primary key":
          if (!t.primaryKey.includes(name)) t.primaryKey.push(name);
          col.nullable = false;
          break;
        case "unique":
          t.uniques.push({ columns: [name] });
          break;
        case "check":
          ownChecks.push(exprText(c.expr as Expr));
          break;
        case "reference": {
          const ft = c.foreignTable as { name: string; schema?: string };
          const fc = refList(c.foreignColumns as Array<{ name: string }> | undefined);
          t.foreignKeys.push({
            columns: [name],
            refSchema: ft.schema ?? schema,
            refTable: ft.name,
            refColumns: fc,
            deferrable: hint?.deferrable ?? false,
            ...(typeof c.onDelete === "string" ? { onDelete: c.onDelete } : {}),
          });
          break;
        }
        case "add generated": {
          col.hasDefault = true;
          if (c.expression) col.generated = true;
          else col.identity = c.always === "always" ? "always" : "by-default";
          break;
        }
        default:
          break;
      }
    }
    if (check) col.check = check;
    t.columns.push(col);
    for (const text of ownChecks) this.applyCheck(t, text);
  }

  private tableConstraint(t: Table, raw: unknown, hints: Map<string, Hint>): void {
    const c = raw as Record<string, unknown> & { type: string; constraintName?: { name: string } };
    const name = c.constraintName?.name;
    switch (c.type) {
      case "primary key": {
        const cols = (c.columns as Array<{ name: string }>).map(ident);
        t.primaryKey = cols;
        for (const col of t.columns) if (cols.includes(col.name)) col.nullable = false;
        break;
      }
      case "unique":
        t.uniques.push({ ...(name ? { name } : {}), columns: (c.columns as Array<{ name: string }>).map(ident) });
        break;
      case "foreign key": {
        const local = (c.localColumns as Array<{ name: string }>).map(ident);
        const ft = c.foreignTable as { name: string; schema?: string };
        const fk: ForeignKey = {
          ...(name ? { name } : {}),
          columns: local,
          refSchema: ft.schema ?? t.schema,
          refTable: ft.name,
          refColumns: refList(c.foreignColumns as Array<{ name: string }> | undefined),
          deferrable: hints.get(`fk:${local.join(",")}`)?.deferrable ?? false,
          ...(typeof c.onDelete === "string" ? { onDelete: c.onDelete } : {}),
        };
        t.foreignKeys.push(fk);
        break;
      }
      case "check":
        this.applyCheck(t, exprText(c.expr as Expr));
        break;
      default:
        break;
    }
  }

  addCreateTable(statement: string): void {
    const head = /^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))?)/i.exec(
      statement,
    );
    const label = head?.[1] ?? statement.slice(0, 40);
    const open = statement.indexOf("(", head ? head[0].length : 0);
    if (!head || open === -1 || /\bpartition\s+of\b/i.test(statement.slice(0, open))) {
      return this.warn(`Skipped table ${label}: partitions and unusual CREATE TABLE forms are not supported`);
    }
    const close = matching(statement, open);
    if (close === -1) return this.warn(`Skipped table ${label}: unbalanced parentheses`);
    const tail = statement.slice(close + 1);
    if (/\binherits\s*\(/i.test(tail)) this.warn(`Table ${label}: INHERITS is ignored; parent columns are not copied`);
    if (/\bpartition\s+by\b/i.test(tail)) this.warn(`Table ${label}: partitioned table; rows are generated against the parent`);
    const { parts, hints } = normaliseTableBody(splitTopLevel(statement.slice(open + 1, close)));
    if (parts.some((p) => /^like\s/i.test(p))) this.warn(`Table ${label}: LIKE clauses are not expanded`);
    const rebuilt = `${statement.slice(0, open)}(${parts.filter((p) => !/^like\s/i.test(p)).join(", ")})`;
    let parsed: Statement | undefined;
    try {
      parsed = parse(rebuilt)[0];
    } catch (e) {
      return this.warn(`Skipped table ${label}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    }
    if (!parsed || parsed.type !== "create table") return;
    const schema = parsed.name.schema ?? "public";
    const t: Table = { schema, name: parsed.name.name, columns: [], primaryKey: [], uniques: [], foreignKeys: [] };
    for (const c of parsed.columns) {
      if (c.kind !== "column") continue;
      this.buildColumn(t.name, c, t, hints.get(`col:${c.name.name}`), schema);
    }
    for (const c of parsed.constraints ?? []) this.tableConstraint(t, c, hints);
    const existing = this.findTable(t.schema, t.name);
    if (existing) this.tables.splice(this.tables.indexOf(existing), 1);
    this.tables.push(t);
  }

  addAlterTable(statement: string): void {
    // Serial-ness and identity expressed after the fact (pg_dump style).
    const seq = /^alter\s+table\s+(?:only\s+)?(.+?)\s+alter\s+column\s+("[^"]+"|\w+)\s+(?:set\s+default\s+nextval|add\s+generated\s+(always|by\s+default)\s+as\s+identity)/is.exec(
      statement,
    );
    if (seq) {
      const q = splitQualified(seq[1] ?? "");
      const t = this.findTable(q.schema, q.name);
      const col = t?.columns.find((c) => c.name === (seq[2] ?? "").replace(/"/g, ""));
      if (col) {
        col.hasDefault = true;
        if (seq[3]) col.identity = /always/i.test(seq[3]) ? "always" : "by-default";
        else col.serial = true;
      }
      return;
    }
    const m = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(\S+)\s+([\s\S]*)$/i.exec(statement);
    if (!m) return;
    const rest = m[2] ?? "";
    if (!/^(add\s+(constraint|primary|unique|foreign|check|column))/i.test(rest)) return;
    const { parts, hints } = normaliseTableBody([rest]);
    const text = `ALTER TABLE ${m[1]} ${parts[0]}`;
    let parsed: Statement | undefined;
    try {
      parsed = parse(text.replace(/^ALTER TABLE ONLY /i, "ALTER TABLE "))[0];
    } catch (e) {
      return this.warn(`Skipped ALTER TABLE ${m[1]}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    }
    if (!parsed || parsed.type !== "alter table") return;
    const schema = parsed.table.schema ?? "public";
    const t = this.findTable(schema, parsed.table.name);
    if (!t) return;
    for (const ch of parsed.changes) {
      if (ch.type === "add constraint") {
        const cc = ch.constraint as { type: string; localColumns?: Array<{ name: string }> };
        if (cc.type === "foreign key" && cc.localColumns) {
          const key = `fk:${cc.localColumns.map(ident).join(",")}`;
          const dm = /deferrable/i.test(rest) && !/not\s+deferrable/i.test(rest);
          hints.set(key, { deferrable: dm });
        }
        this.tableConstraint(t, ch.constraint, hints);
      } else if (ch.type === "add column") {
        this.buildColumn(t.name, ch.column, t, hints.get(`col:${ch.column.name.name}`), schema);
      }
    }
  }

  addIndex(statement: string): void {
    let parsed: Statement | undefined;
    try {
      parsed = parse(statement)[0];
    } catch (e) {
      return this.warn(`Skipped a unique index: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    }
    if (!parsed || parsed.type !== "create index" || !parsed.unique) return;
    const t = this.findTable(parsed.table.schema ?? "public", parsed.table.name);
    if (!t) return;
    const columns: string[] = [];
    let transform: "lower" | undefined;
    for (const item of parsed.expressions) {
      const e = item.expression;
      if (e.type === "ref") columns.push(e.name);
      else if (e.type === "call" && e.function.name.toLowerCase() === "lower" && e.args[0]?.type === "ref") {
        columns.push(e.args[0].name);
        transform = "lower";
      } else {
        return this.warn(
          `Unique index ${parsed.indexName?.name ?? ""} on ${t.name} uses an expression that is not supported, so uniqueness is not enforced for it`,
        );
      }
    }
    t.uniques.push({
      ...(parsed.indexName ? { name: parsed.indexName.name } : {}),
      columns,
      ...(transform ? { transform } : {}),
      ...(parsed.where ? { partial: true } : {}),
    });
  }
}

/**
 * Builds the IR from DDL text. Statements that cannot be understood produce a warning and are
 * skipped; this function never throws on bad SQL.
 */
export function parseDdl(sql: string): Database {
  const b = new Builder();
  const statements = splitStatements(sql);
  // Types first, so that tables declared before or after them resolve the same way.
  for (const s of statements) {
    if (/^create\s+type\b/i.test(s) && /\bas\s+enum\b/i.test(s)) {
      try {
        const st = parse(s)[0];
        if (st && st.type === "create enum") b.addEnum(st.name.schema ?? "public", st.name.name, st.values.map((v) => v.value));
      } catch {
        const m = /^create\s+type\s+(\S+)\s+as\s+enum\s*\(([\s\S]*)\)/i.exec(s);
        if (m) {
          const q = splitQualified(m[1] ?? "");
          b.addEnum(q.schema, q.name, [...(m[2] ?? "").matchAll(/'((?:[^']|'')*)'/g)].map((x) => (x[1] ?? "").replace(/''/g, "'")));
        }
      }
    } else if (/^create\s+domain\b/i.test(s)) b.addDomain(s);
  }
  for (const s of statements) {
    if (/^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\b/i.test(s)) b.addCreateTable(s);
  }
  for (const s of statements) {
    if (/^alter\s+table\b/i.test(s)) b.addAlterTable(s);
    else if (/^create\s+unique\s+index\b/i.test(s)) b.addIndex(s);
  }
  // Foreign keys without a column list reference the primary key of the parent.
  for (const t of b.tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refColumns.length === 0) {
        const parent = b.findTable(fk.refSchema, fk.refTable);
        if (parent && parent.primaryKey.length === fk.columns.length) fk.refColumns = [...parent.primaryKey];
      }
    }
  }
  return { tables: b.tables, enums: b.enums, warnings: b.warnings };
}
