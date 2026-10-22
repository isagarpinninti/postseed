import { getTable, tableKey, type Database, type ForeignKey } from "./ir";

export interface DeferredForeignKey {
  fk: ForeignKey;
  /** `null`: inserted as NULL then UPDATEd. `deferred`: placeholder value under SET CONSTRAINTS ALL DEFERRED, then UPDATEd. */
  via: "null" | "deferred";
}

export interface Plan {
  /** Table keys, parents before children. */
  order: string[];
  deferred: Map<string, DeferredForeignKey[]>;
  deferConstraints: boolean;
  errors: string[];
  warnings: string[];
}

const fkTarget = (fk: ForeignKey): string => `${fk.refSchema}.${fk.refTable}`;

/** Strongly connected components (Tarjan), iterative. Components come out in reverse topological order. */
function tarjan(nodes: string[], edges: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ v: string; i: number }> = [{ v: root, i: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { v: string; i: number };
      const next = edges.get(frame.v) ?? [];
      if (frame.i < next.length) {
        const w = next[frame.i++] as string;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v) as number, index.get(w) as number));
        }
      } else {
        if (low.get(frame.v) === index.get(frame.v)) {
          const comp: string[] = [];
          for (;;) {
            const w = stack.pop() as string;
            onStack.delete(w);
            comp.push(w);
            if (w === frame.v) break;
          }
          out.push(comp);
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) low.set(parent.v, Math.min(low.get(parent.v) as number, low.get(frame.v) as number));
      }
    }
  }
  return out;
}

/**
 * Orders the selected tables so parents come first and breaks foreign-key cycles:
 * nullable keys are inserted as NULL and filled in by an UPDATE; otherwise deferrable keys use
 * SET CONSTRAINTS ALL DEFERRED; otherwise the selection cannot be inserted and an error says why.
 * Self-references are not edges: the generator handles them row by row.
 */
export function planTables(db: Database, selected: readonly string[]): Plan {
  const keys = db.tables.map(tableKey).filter((k) => selected.includes(k));
  const inSet = new Set(keys);
  const plan: Plan = { order: [], deferred: new Map(), deferConstraints: false, errors: [], warnings: [] };
  const broken = new Set<ForeignKey>();

  const buildEdges = (): Map<string, string[]> => {
    const edges = new Map<string, string[]>();
    for (const k of keys) {
      const t = getTable(db, k);
      const targets = new Set<string>();
      for (const fk of t.foreignKeys) {
        const p = fkTarget(fk);
        if (broken.has(fk) || p === k || !inSet.has(p)) continue;
        targets.add(p);
      }
      edges.set(k, [...targets]);
    }
    return edges;
  };

  for (let guard = 0; guard < 1000; guard++) {
    const edges = buildEdges();
    const cyclic = tarjan(keys, edges).find((c) => c.length > 1);
    if (!cyclic) break;
    const members = new Set(cyclic);
    const candidates: Array<{ table: string; fk: ForeignKey }> = [];
    for (const k of keys) {
      if (!members.has(k)) continue;
      for (const fk of getTable(db, k).foreignKeys) {
        if (!broken.has(fk) && members.has(fkTarget(fk)) && fkTarget(fk) !== k) candidates.push({ table: k, fk });
      }
    }
    const nullable = (c: { table: string; fk: ForeignKey }): boolean => {
      const t = getTable(db, c.table);
      return c.fk.columns.every((n) => t.columns.find((col) => col.name === n)?.nullable === true);
    };
    const hasPk = (c: { table: string }): boolean => getTable(db, c.table).primaryKey.length > 0;
    const pick =
      candidates.find((c) => nullable(c) && hasPk(c)) ??
      candidates.find((c) => c.fk.deferrable && hasPk(c));
    if (!pick) {
      const names = [...members].sort().join(", ");
      plan.errors.push(
        `Tables ${names} reference each other in a cycle, and no foreign key in it is nullable or deferrable ` +
          `(on a table with a primary key), so rows cannot be inserted. Make one of the keys nullable or DEFERRABLE.`,
      );
      return plan;
    }
    const via = nullable(pick) ? "null" : "deferred";
    broken.add(pick.fk);
    if (via === "deferred") plan.deferConstraints = true;
    const list = plan.deferred.get(pick.table) ?? [];
    list.push({ fk: pick.fk, via });
    plan.deferred.set(pick.table, list);
    plan.warnings.push(
      `${pick.table}(${pick.fk.columns.join(", ")}) → ${fkTarget(pick.fk)} is part of a cycle: ` +
        (via === "null" ? "inserted as NULL, then filled in by an UPDATE" : "inserted under SET CONSTRAINTS ALL DEFERRED, then updated"),
    );
  }

  // Kahn's algorithm with a stable tie-break (schema order), over the acyclic remainder.
  const edges = buildEdges();
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const k of keys) {
    pending.set(k, (edges.get(k) ?? []).length);
    for (const p of edges.get(k) ?? []) dependents.set(p, [...(dependents.get(p) ?? []), k]);
  }
  const ready = keys.filter((k) => pending.get(k) === 0);
  while (ready.length > 0) {
    const k = ready.shift() as string;
    plan.order.push(k);
    for (const c of dependents.get(k) ?? []) {
      const left = (pending.get(c) as number) - 1;
      pending.set(c, left);
      if (left === 0) {
        ready.push(c);
        ready.sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
      }
    }
  }
  return plan;
}

/** Selected tables whose foreign keys point at tables outside the selection. */
export function findMissingParents(
  db: Database,
  selected: readonly string[],
): Array<{ table: string; parent: string; columns: string[] }> {
  const out: Array<{ table: string; parent: string; columns: string[] }> = [];
  for (const k of selected) {
    const t = db.tables.find((x) => tableKey(x) === k);
    if (!t) continue;
    for (const fk of t.foreignKeys) {
      const p = fkTarget(fk);
      if (p !== k && !selected.includes(p)) out.push({ table: k, parent: p, columns: fk.columns });
    }
  }
  return out;
}
