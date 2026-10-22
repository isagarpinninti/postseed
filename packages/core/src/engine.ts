import { PostseedError, bumpValue, compareValues, defaultGen, domainSize, formatTemporal } from "./columns";
import { Env, fakerFn, DEFAULT_NOW, type Gen } from "./env";
import { getTable, resolveTableKey, tableKey, type Column, type Database, type ForeignKey, type Table } from "./ir";
import { planTables, type Plan } from "./planner";
import { Rng } from "./prng";
import { isTemporal } from "./types";
import type { Value } from "./value";

export const VERSION = "0.1.0";

/* ───────────────────────── options ───────────────────────── */

/** Replaces how one column is generated. At most one generator field may be set. */
export interface ColumnOverride {
  value?: Value;
  pick?: Value[];
  weights?: number[];
  int?: [number, number];
  float?: [number, number];
  decimals?: number;
  /** A Faker method path such as `internet.email` or `commerce.productName`. */
  faker?: string;
  args?: unknown[];
  /** `user{n}@example.com`; `{n}` is the 1-based row number. */
  template?: string;
  nullRatio?: number;
}

/** Rows that already exist in the target database, for appending and for foreign keys into unselected tables. */
export interface ExistingData {
  /** Referenced-column values of rows in tables that are not being generated. */
  keys?: Record<string, Array<Record<string, Value>>>;
  /** Current maximum of sequential columns, so new ids continue after them. */
  maxIds?: Record<string, Record<string, number>>;
  /** Existing unique tuples (see `uniqueKey`) per table and constraint (`col1,col2`). */
  unique?: Record<string, Record<string, string[]>>;
}

export interface GenerateOptions {
  seed?: number;
  /** Rows per table (default 50). */
  rows?: number;
  tableRows?: Record<string, number>;
  /** Tables to generate, as `schema.table` or a bare unambiguous name. Default: all. */
  tables?: string[];
  /** Probability that a nullable column is NULL (default 0.1). */
  nullRatio?: number;
  /** First id for sequential columns. */
  startId?: number | Record<string, number>;
  overrides?: Record<string, ColumnOverride>;
  fkDistribution?: "uniform" | "zipf";
  /** Fraction of a self-referencing table that are roots (default 0.1). */
  rootRatio?: number;
  existing?: ExistingData;
  /** Reference date for relative timestamps (default: a constant, so output never depends on the clock). */
  now?: string | number | Date;
  /** Recorded in the SQL header. */
  name?: string;
}

/* ───────────────────────── events ───────────────────────── */

export interface SequenceSync {
  column: string;
  value: number;
}

export type GenEvent =
  | {
      type: "begin";
      seed: number;
      name: string | undefined;
      tables: Array<{ key: string; rows: number }>;
      deferConstraints: boolean;
      /** True when keys in a cycle are filled by UPDATEs after the inserts. */
      hasUpdates: boolean;
      warnings: string[];
    }
  | {
      type: "table";
      key: string;
      table: Table;
      columns: Column[];
      rows: number;
      /** Set by previews that print only the first rows of a longer table. */
      shown?: number;
      fkNotes: string[];
      overridingSystem: boolean;
    }
  | { type: "rows"; key: string; table: Table; columns: Column[]; rows: Value[][]; offset: number }
  | { type: "table-end"; key: string; table: Table; sequences: SequenceSync[] }
  | {
      type: "updates";
      key: string;
      table: Table;
      setColumns: Column[];
      pkColumns: Column[];
      rows: Array<{ pk: Value[]; set: Value[] }>;
    }
  | { type: "end"; counts: Record<string, number>; warnings: string[] };

/* ───────────────────────── preparation ───────────────────────── */

export interface Prepared {
  selected: string[];
  plan: Plan;
  rows: Record<string, number>;
  errors: Array<{ code: PostseedError["code"]; message: string }>;
  warnings: string[];
}

const fkTarget = (fk: ForeignKey): string => `${fk.refSchema}.${fk.refTable}`;
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Resolves the selection, orders it, and reports everything that would stop generation, without generating. */
export function prepare(db: Database, options: GenerateOptions = {}): Prepared {
  const errors: Prepared["errors"] = [];
  const warnings = [...db.warnings];
  const all = db.tables.map(tableKey);
  let selected = all;
  if (options.tables && options.tables.length > 0) {
    selected = [];
    for (const ref of options.tables) {
      const k = resolveTableKey(db, ref);
      if (!k) errors.push({ code: "UNKNOWN_TABLE", message: `Unknown table "${ref}". Known tables: ${all.join(", ")}` });
      else if (!selected.includes(k)) selected.push(k);
    }
  }
  const rows: Record<string, number> = {};
  for (const k of selected) {
    const t = getTable(db, k);
    const override = options.tableRows?.[k] ?? options.tableRows?.[t.name];
    rows[k] = Math.max(0, Math.floor(override ?? options.rows ?? 50));
  }
  const plan = planTables(db, selected);
  for (const e of plan.errors) errors.push({ code: "CYCLE", message: e });
  warnings.push(...plan.warnings);
  for (const k of selected) {
    const t = getTable(db, k);
    for (const fk of t.foreignKeys) {
      const p = fkTarget(fk);
      const nullable = fk.columns.every((c) => t.columns.find((x) => x.name === c)?.nullable === true);
      if (p === k) continue;
      if (selected.includes(p)) {
        if ((rows[p] ?? 0) === 0 && !nullable && (rows[k] ?? 0) > 0) {
          errors.push({
            code: "NO_ROWS",
            message: `${t.name}(${fk.columns.join(", ")}) references ${fk.refTable}, but ${fk.refTable} has 0 rows to reference.`,
          });
        }
        continue;
      }
      const have = options.existing?.keys?.[p]?.length ?? 0;
      if (have === 0) {
        if (nullable) {
          warnings.push(`${t.name}.${fk.columns.join(", ")} references ${fk.refTable}, which is not selected and has no rows; it will be NULL.`);
        } else if ((rows[k] ?? 0) > 0) {
          errors.push({
            code: "MISSING_PARENT",
            message: `${t.name} references ${fk.refTable}, which is not selected and has no existing rows. Select ${fk.refTable} too.`,
          });
        }
      }
    }
  }
  return { selected, plan, rows, errors, warnings };
}

/* ───────────────────────── helpers ───────────────────────── */

interface KeyStore {
  cols: string[];
  index: Map<string, number>;
  rows: Value[][];
}

const keyOf = (values: readonly Value[], lower: boolean): string | null => {
  let s = "";
  for (const v of values) {
    if (v === null) return null;
    const part = typeof v === "string" ? (lower ? v.toLowerCase() : v) : JSON.stringify(v);
    s += `${part}\u0001`;
  }
  return s;
};

/** Canonical string for a unique tuple; the database layer uses the same function for existing rows. */
export const uniqueKey = (values: readonly Value[], lower = false): string | null => keyOf(values, lower);

const MAX_ATTEMPTS = 50;
const SUFFIX_AFTER = 6;
const CHUNK = 1000;

function suffixed(v: Value, i: number, attempt: number, col: Column): Value {
  if (typeof v !== "string") return v;
  const tag = attempt === SUFFIX_AFTER ? String(i + 1) : `${i + 1}x${attempt}`;
  const max = Math.min(col.type.length ?? Infinity, col.check?.maxLen ?? Infinity);
  const at = v.indexOf("@");
  if (at > 0) {
    const local = v.slice(0, at);
    const domain = v.slice(at);
    const room = Number.isFinite(max) ? Math.max(1, max - domain.length - tag.length - 1) : local.length;
    return `${local.slice(0, room)}+${tag}${domain}`;
  }
  const room = Number.isFinite(max) ? Math.max(0, max - tag.length - 1) : v.length;
  return `${v.slice(0, room)}-${tag}`;
}

const placeholder = (c: Column): Value => {
  switch (c.type.kind) {
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "text":
    case "varchar":
    case "char":
      return "x".slice(0, c.type.length ?? 1);
    default:
      return 0;
  }
};

const CHAINS: Array<RegExp[]> = [
  [/(^|_)created(_|$)/, /(^|_)(updated|modified)(_|$)/],
  [/(^|_)created(_|$)/, /(^|_)(deleted|cancel+ed|closed|archived|completed|resolved|expires|expired)(_|$)/],
  [/(^|_)(placed|ordered|opened|issued|submitted)(_|$)/, /(^|_)paid(_|$)/, /(^|_)shipped(_|$)/, /(^|_)(delivered|completed|fulfilled)(_|$)/],
  [/^(start|starts|started|begin|begins)(_|$)/, /^(end|ends|ended|finish|finished)(_|$)/],
];

/** Makes related timestamps consistent: an `updated_at` never precedes `created_at`, and so on. */
function orderingFinalizers(written: readonly Column[]): Array<(row: Value[]) => void> {
  const out: Array<(row: Value[]) => void> = [];
  for (const chain of CHAINS) {
    const picked: number[] = [];
    for (const re of chain) {
      const idx = written.findIndex((c, i) => isTemporal(c.type.kind) && c.type.array === 0 && re.test(c.name.toLowerCase()) && !picked.includes(i));
      if (idx >= 0) picked.push(idx);
    }
    const kinds = new Set(picked.map((i) => written[i]?.type.kind));
    if (picked.length < 2 || kinds.size !== 1) continue;
    out.push((row) => {
      const present = picked.filter((i) => typeof row[i] === "string");
      const values = present.map((i) => row[i] as string).sort();
      present.forEach((i, n) => {
        row[i] = values[n] as string;
      });
    });
  }
  return out;
}

/** Enforces CHECKs that compare two columns of a row (`ends_at >= starts_at`, `a <> b`) by ordering or nudging values. */
function relationFinalizers(t: Table, written: readonly Column[]): Array<(row: Value[]) => void> {
  const out: Array<(row: Value[]) => void> = [];
  for (const r of t.relations ?? []) {
    const li = written.findIndex((c) => c.name === r.left);
    const ri = written.findIndex((c) => c.name === r.right);
    if (li < 0 || ri < 0) continue;
    const lc = written[li] as Column;
    const rc = written[ri] as Column;
    if (lc.type.kind !== rc.type.kind || lc.type.array > 0 || rc.type.array > 0) continue;
    out.push((row) => {
      const a = row[li] as Value;
      const b = row[ri] as Value;
      if (a === null || b === null) return;
      let c = compareValues(a, b, lc);
      if (r.op === "<>") {
        if (c === 0) row[ri] = bumpValue(b, rc, true);
        return;
      }
      const wantAbove = r.op === ">" || r.op === ">=";
      if (wantAbove ? c < 0 : c > 0) {
        row[li] = b;
        row[ri] = a;
        c = -c;
      }
      if (c === 0 && (r.op === ">" || r.op === "<")) row[li] = bumpValue(row[li] as Value, lc, wantAbove);
    });
  }
  return out;
}

interface Slot {
  cols: number[];
  run: (row: Value[], i: number, attempt: number) => void;
}

function overrideGen(env: Env, o: ColumnOverride, label: string): Gen {
  const set = [o.value !== undefined, o.pick, o.int, o.float, o.faker, o.template].filter((x) => x !== undefined && x !== false);
  if (set.length > 1) throw new PostseedError(`Override for ${label} sets more than one generator.`, "BAD_OVERRIDE");
  const rng = env.rng;
  if (o.value !== undefined) return () => o.value as Value;
  if (o.pick) {
    const items = o.pick;
    if (items.length === 0) throw new PostseedError(`Override for ${label}: "pick" is empty.`, "BAD_OVERRIDE");
    const w = o.weights;
    if (w && w.length !== items.length) throw new PostseedError(`Override for ${label}: "weights" must match "pick".`, "BAD_OVERRIDE");
    return w ? () => items[rng.weightedIndex(w)] as Value : () => rng.pick(items);
  }
  if (o.int) return () => rng.int(o.int?.[0] ?? 0, o.int?.[1] ?? 0);
  if (o.float) {
    const d = o.decimals ?? 2;
    const f = 10 ** d;
    const [lo, hi] = o.float;
    return () => Math.round((lo + rng.float() * (hi - lo)) * f) / f;
  }
  if (o.template) {
    const t = o.template;
    return (i) => t.replace(/\{n\}/g, String(i + 1));
  }
  if (o.faker) {
    let fn: (...a: unknown[]) => unknown;
    try {
      fn = fakerFn(env.faker, o.faker);
    } catch (e) {
      throw new PostseedError(`Override for ${label}: ${(e as Error).message}`, "BAD_OVERRIDE");
    }
    const args = o.args ?? [];
    return () => {
      const v = fn(...args);
      if (v instanceof Date) return v.toISOString();
      return v as Value;
    };
  }
  throw new PostseedError(`Override for ${label} does not set a generator.`, "BAD_OVERRIDE");
}

/* ───────────────────────── generation ───────────────────────── */

/**
 * Generates seed data as a stream of events. Pure and deterministic: the same schema, options and
 * library version always produce the same events, in the same order.
 */
export function* generate(db: Database, options: GenerateOptions = {}): Generator<GenEvent> {
  const seed = options.seed ?? 42;
  const nullRatio = Math.min(1, Math.max(0, options.nullRatio ?? 0.1));
  const prep = prepare(db, options);
  if (prep.errors.length > 0) {
    throw new PostseedError(prep.errors.map((e) => e.message).join("\n"), prep.errors[0]?.code ?? "UNSUPPORTED");
  }
  const { plan } = prep;
  const warnings = [...prep.warnings];
  const now = options.now === undefined ? DEFAULT_NOW : new Date(options.now).getTime();
  const existing = options.existing ?? {};
  const rootRatio = options.rootRatio ?? 0.1;

  // Which columns of each table must be remembered for children (and for UPDATEs after cycles).
  const storeCols = new Map<string, Set<string>>();
  const need = (key: string, cols: readonly string[]): void => {
    const s = storeCols.get(key) ?? new Set<string>();
    for (const c of cols) s.add(c);
    storeCols.set(key, s);
  };
  for (const k of prep.selected) {
    const t = getTable(db, k);
    for (const fk of t.foreignKeys) need(fkTarget(fk), fk.refColumns);
    if (plan.deferred.has(k)) need(k, t.primaryKey);
  }

  const stores = new Map<string, KeyStore>();
  const mkStore = (key: string): KeyStore => {
    const cols = [...(storeCols.get(key) ?? [])];
    return { cols, index: new Map(cols.map((c, i) => [c, i])), rows: [] };
  };
  for (const k of prep.selected) stores.set(k, mkStore(k));
  for (const k of storeCols.keys()) {
    if (stores.has(k)) continue;
    const s = mkStore(k);
    for (const rec of existing.keys?.[k] ?? []) s.rows.push(s.cols.map((c) => rec[c] ?? null));
    stores.set(k, s);
  }

  yield { type: "begin", seed, name: options.name, tables: prep.selected.map((k) => ({ key: k, rows: prep.rows[k] ?? 0 })), deferConstraints: plan.deferConstraints, hasUpdates: plan.deferred.size > 0, warnings };

  const counts: Record<string, number> = {};
  const selectedSet = new Set(prep.selected);

  for (const key of plan.order) {
    const t = getTable(db, key);
    const n = prep.rows[key] ?? 0;
    const store = stores.get(key) as KeyStore;
    const written = t.columns.filter((c) => {
      if (c.generated) return false;
      if (c.type.kind === "unsupported") {
        if (!c.nullable && !c.hasDefault) warnings.push(`${t.name}.${c.name} has the unsupported type "${c.type.name}" and no default; the insert will fail unless you add an override.`);
        return !!options.overrides?.[`${key}.${c.name}`] || !!options.overrides?.[`${t.name}.${c.name}`];
      }
      return true;
    });
    const colIdx = new Map(written.map((c, i) => [c.name, i]));
    const deferredHere = plan.deferred.get(key) ?? [];
    const deferredFks = new Set(deferredHere.map((d) => d.fk));
    const slots: Slot[] = [];
    const finalizers: Array<(row: Value[], i: number) => void> = [];
    const fkNotes: string[] = [];
    const claimed = new Set<number>();
    let seqStart: Record<string, number> = {};

    // Capacity of UNIQUE columns is checked before a single row exists.
    const constraints = [
      ...(t.primaryKey.length > 0 ? [{ columns: t.primaryKey, transform: undefined as "lower" | undefined, name: "primary key" }] : []),
      ...t.uniques.map((u) => ({ columns: u.columns, transform: u.transform, name: u.name ?? "unique constraint" })),
    ].filter((c) => c.columns.every((x) => colIdx.has(x)));

    /* Foreign keys */
    for (const fk of t.foreignKeys) {
      if (!fk.columns.every((c) => colIdx.has(c))) {
        warnings.push(`${t.name}(${fk.columns.join(", ")}) is a foreign key on columns that are not written; it is skipped.`);
        continue;
      }
      const idxs = fk.columns.map((c) => colIdx.get(c) as number);
      if (idxs.some((x) => claimed.has(x))) {
        warnings.push(`${t.name}: a column belongs to more than one foreign key, so those keys may not reference the same parent row.`);
      }
      idxs.forEach((x) => claimed.add(x));
      const parentKey = fkTarget(fk);
      fkNotes.push(`${fk.columns.join(", ")} → ${fk.refTable}`);
      const nullableAll = fk.columns.every((c) => t.columns.find((x) => x.name === c)?.nullable === true);
      const rng = Rng.fromKey(seed, key, `fk:${fk.columns.join(",")}`);
      const nullRng = Rng.fromKey(seed, key, `fk:${fk.columns.join(",")}`, "null");
      const nullOverride = fk.columns.map((c) => options.overrides?.[`${key}.${c}`]?.nullRatio ?? options.overrides?.[`${t.name}.${c}`]?.nullRatio).find((x) => x !== undefined);
      const nr = nullOverride ?? nullRatio;

      if (deferredFks.has(fk)) {
        const via = deferredHere.find((d) => d.fk === fk)?.via;
        slots.push({
          cols: idxs,
          run: (row) => {
            fk.columns.forEach((c, k) => {
              row[idxs[k] as number] = via === "null" ? null : placeholder(t.columns.find((x) => x.name === c) as Column);
            });
          },
        });
        continue;
      }

      const parent = stores.get(parentKey);
      const isSelf = parentKey === key;
      if (!parent) {
        slots.push({ cols: idxs, run: (row) => idxs.forEach((x) => (row[x] = null)) });
        continue;
      }
      const refIdx = fk.refColumns.map((c) => parent.index.get(c));
      if (refIdx.some((x) => x === undefined)) {
        warnings.push(`${t.name}: foreign key to ${fk.refTable} references columns that were not generated; it is skipped.`);
        continue;
      }
      const roots = isSelf ? Math.max(1, Math.round(n * rootRatio)) : 0;
      const exactlyUnique = constraints.some((c) => sameSet(c.columns, fk.columns));
      let perm: number[] | undefined;
      const zipf = options.fkDistribution === "zipf";
      const pickIndex = (len: number, i: number): number => {
        if (exactlyUnique && !isSelf) {
          if (!perm) {
            if (n > len) {
              throw new PostseedError(
                `${t.name}.${fk.columns.join(", ")} is unique and references ${fk.refTable}, which has only ${len} row(s); ${n} rows were requested.`,
                "UNIQUE_EXHAUSTED",
              );
            }
            perm = rng.shuffle(Array.from({ length: len }, (_, x) => x));
          }
          return perm[i] as number;
        }
        if (zipf) return Math.min(len - 1, Math.max(0, Math.floor(len ** rng.float()) - 1));
        return rng.int(0, len - 1);
      };
      slots.push({
        cols: idxs,
        run: (row, i, attempt) => {
          if (isSelf && i < roots) {
            if (nullableAll) {
              idxs.forEach((x) => (row[x] = null));
            }
            return; // non-nullable roots reference themselves in the finalizer
          }
          // The draw always happens so streams stay aligned; a retry never answers a clash with NULL.
          if (nullableAll && nullRng.float() < nr && attempt === 0) {
            idxs.forEach((x) => (row[x] = null));
            return;
          }
          const rows = parent.rows;
          const limit = isSelf ? Math.min(rows.length, i) : rows.length;
          if (limit === 0) {
            if (nullableAll) idxs.forEach((x) => (row[x] = null));
            return;
          }
          const tuple = rows[pickIndex(limit, i)] as Value[];
          for (let k = 0; k < idxs.length; k++) row[idxs[k] as number] = tuple[refIdx[k] as number] as Value;
        },
      });
      if (isSelf && !nullableAll) {
        const refWritten = fk.refColumns.map((c) => colIdx.get(c));
        if (refWritten.every((x) => x !== undefined)) {
          finalizers.push((row, i) => {
            if (i < roots) idxs.forEach((x, k) => (row[x] = row[refWritten[k] as number] as Value));
          });
        }
      }
    }

    /* Plain columns */
    const sequentialCols = new Set<string>();
    const pkSingle = t.primaryKey.length === 1 ? t.primaryKey[0] : undefined;
    const uniqueSingles = new Set(constraints.filter((c) => c.columns.length === 1).map((c) => c.columns[0] as string));
    for (const c of written) {
      const idx = colIdx.get(c.name) as number;
      if (claimed.has(idx)) continue;
      const oKey = options.overrides?.[`${key}.${c.name}`] ?? options.overrides?.[`${t.name}.${c.name}`];
      const colRng = Rng.fromKey(seed, key, c.name);
      const fakerSeed = Rng.fromKey(seed, key, c.name, "faker").uint32();
      const env = new Env(colRng, fakerSeed, t, c, now);
      const integral = c.type.kind === "smallint" || c.type.kind === "int" || c.type.kind === "bigint";
      const sequential = !oKey && c.type.array === 0 && integral && (c.identity !== undefined || c.serial || (c.name === pkSingle && !claimed.has(idx)));
      const nullRng = Rng.fromKey(seed, key, c.name, "null");
      const nr = oKey?.nullRatio ?? nullRatio;
      const canBeNull = c.nullable && !t.primaryKey.includes(c.name);
      let gen: Gen | undefined;
      let suffixable = false;
      if (sequential) {
        sequentialCols.add(c.name);
        const start =
          (typeof options.startId === "number" ? options.startId : options.startId?.[`${key}.${c.name}`] ?? options.startId?.[t.name]) ??
          (existing.maxIds?.[key]?.[c.name] !== undefined ? (existing.maxIds[key]?.[c.name] as number) + 1 : undefined) ??
          c.start ??
          1;
        seqStart = { ...seqStart, [c.name]: start };
        gen = (i) => start + i;
      } else if (oKey && (oKey.value !== undefined || oKey.pick || oKey.int || oKey.float || oKey.faker || oKey.template)) {
        gen = overrideGen(env, oKey, `${t.name}.${c.name}`);
      } else {
        const span = uniqueSingles.has(c.name) ? n * 10 : undefined;
        gen = defaultGen(env, c, db.enums, span);
        if (uniqueSingles.has(c.name) && (c.type.kind === "text" || c.type.kind === "varchar" || c.type.kind === "char")) suffixable = true;
      }
      if (!gen) {
        if (!c.nullable && !c.hasDefault) warnings.push(`${t.name}.${c.name} (${c.type.name}) cannot be generated; NULL is used.`);
        slots.push({ cols: [idx], run: (row) => void (row[idx] = null) });
        continue;
      }
      const g = gen;
      slots.push({
        cols: [idx],
        run: (row, i, attempt) => {
          let v = g(i);
          if (suffixable && attempt >= SUFFIX_AFTER) v = suffixed(v, i, attempt, c);
          row[idx] = canBeNull && nullRng.float() < nr && attempt === 0 ? null : v;
        },
      });
    }

    finalizers.push(...orderingFinalizers(written).map((f) => (row: Value[]) => f(row)), ...relationFinalizers(t, written).map((f) => (row: Value[]) => f(row)));

    /* Uniqueness */
    interface Track {
      label: string;
      idxs: number[];
      lower: boolean;
      seen: Set<string>;
      single: boolean;
    }
    const tracks: Track[] = [];
    for (const c of constraints) {
      const idxs = c.columns.map((x) => colIdx.get(x) as number);
      const cols = c.columns.map((x) => t.columns.find((y) => y.name === x) as Column);
      if (cols.some((x) => sequentialCols.has(x.name))) continue;
      if (idxs.length === 1 && cols[0]?.type.kind === "uuid" && !claimed.has(idxs[0] as number)) continue;
      const cap = cols.reduce((acc, x) => acc * (claimed.has(colIdx.get(x.name) as number) ? Infinity : domainSize(x, db.enums)), 1);
      const have = existing.unique?.[key]?.[c.columns.join(",")]?.length ?? 0;
      if (cap < n + have) {
        throw new PostseedError(
          `${t.name}.${c.columns.join(", ")} must be unique but can only take ${cap} distinct value(s); ${n} rows were requested.`,
          "UNIQUE_EXHAUSTED",
        );
      }
      const seen = new Set<string>(existing.unique?.[key]?.[c.columns.join(",")] ?? []);
      tracks.push({ label: `${t.name}.${c.columns.join(", ")}`, idxs, lower: c.transform === "lower", seen, single: idxs.length === 1 });
    }

    const slotsFor = (failing: Track[]): Slot[] => {
      const touched = new Set(failing.flatMap((f) => f.idxs));
      return slots.filter((s) => s.cols.some((x) => touched.has(x)));
    };

    const overridingSystem = written.some((c) => c.identity === "always");
    yield { type: "table", key, table: t, columns: written, rows: n, fkNotes, overridingSystem };

    let chunk: Value[][] = [];
    let offset = 0;
    const keep = store.cols.map((c) => colIdx.get(c));
    for (let i = 0; i < n; i++) {
      const row = new Array<Value>(written.length).fill(null);
      for (const s of slots) s.run(row, i, 0);
      for (const f of finalizers) f(row, i);
      for (let attempt = 0; ; attempt++) {
        const keys = tracks.map((tr) => keyOf(tr.idxs.map((x) => row[x] as Value), tr.lower));
        const failing = tracks.filter((tr, k) => keys[k] !== null && tr.seen.has(keys[k] as string));
        if (failing.length === 0) {
          tracks.forEach((tr, k) => {
            if (keys[k] !== null) tr.seen.add(keys[k] as string);
          });
          break;
        }
        if (attempt + 1 >= MAX_ATTEMPTS) {
          const tr = failing[0] as Track;
          throw new PostseedError(
            `Could not generate a unique value for ${tr.label} at row ${i + 1} after ${MAX_ATTEMPTS} attempts. The column's value space is too small for ${n} rows; use an override or fewer rows.`,
            "UNIQUE_EXHAUSTED",
          );
        }
        for (const s of slotsFor(failing)) s.run(row, i, attempt + 1);
        for (const f of finalizers) f(row, i);
      }
      if (keep.length > 0) store.rows.push(keep.map((x) => (x === undefined ? null : (row[x] as Value))));
      chunk.push(row);
      if (chunk.length >= CHUNK) {
        yield { type: "rows", key, table: t, columns: written, rows: chunk, offset };
        offset += chunk.length;
        chunk = [];
      }
    }
    if (chunk.length > 0) yield { type: "rows", key, table: t, columns: written, rows: chunk, offset };
    counts[key] = n;

    const sequences: SequenceSync[] = [];
    for (const c of written) {
      if (sequentialCols.has(c.name) && (c.identity !== undefined || c.serial) && n > 0) {
        sequences.push({ column: c.name, value: (seqStart[c.name] ?? 1) + n - 1 });
      }
    }
    yield { type: "table-end", key, table: t, sequences };
  }

  /* Cycles: fill the keys that were inserted as NULL (or placeholders) now that every parent exists. */
  for (const key of plan.order) {
    const list = plan.deferred.get(key);
    if (!list) continue;
    const t = getTable(db, key);
    const store = stores.get(key) as KeyStore;
    const pkCols = t.primaryKey.map((c) => t.columns.find((x) => x.name === c) as Column);
    for (const { fk } of list) {
      const parent = stores.get(fkTarget(fk)) as KeyStore;
      const setCols = fk.columns.map((c) => t.columns.find((x) => x.name === c) as Column);
      const rng = Rng.fromKey(seed, key, `fk:${fk.columns.join(",")}`, "deferred");
      const nullRng = Rng.fromKey(seed, key, `fk:${fk.columns.join(",")}`, "deferred-null");
      const nullable = setCols.every((c) => c.nullable);
      const refIdx = fk.refColumns.map((c) => parent.index.get(c) as number);
      const pkIdx = t.primaryKey.map((c) => store.index.get(c) as number);
      let batch: Array<{ pk: Value[]; set: Value[] }> = [];
      for (const r of store.rows) {
        if (nullable && nullRng.float() < nullRatio) continue;
        if (parent.rows.length === 0) continue;
        const tuple = parent.rows[rng.int(0, parent.rows.length - 1)] as Value[];
        batch.push({ pk: pkIdx.map((x) => r[x] as Value), set: refIdx.map((x) => tuple[x] as Value) });
        if (batch.length >= CHUNK) {
          yield { type: "updates", key, table: t, setColumns: setCols, pkColumns: pkCols, rows: batch };
          batch = [];
        }
      }
      if (batch.length > 0) yield { type: "updates", key, table: t, setColumns: setCols, pkColumns: pkCols, rows: batch };
    }
  }
  void selectedSet;
  void formatTemporal;
  yield { type: "end", counts, warnings };
}
