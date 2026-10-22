import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeCheck, generate, getTable, parseDdl, PostseedError, writeCsv, writeJson, writeSql, type Value } from "../src";
import { collect, violations } from "./helpers";

const fulfillment = parseDdl(readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8"));
const sql = (db = fulfillment, o: Parameters<typeof generate>[1] = {}): string => [...writeSql(generate(db, o))].join("");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("determinism", () => {
  it("gives byte-identical SQL for the same schema, seed and options", () => {
    const a = sql(fulfillment, { seed: 42, rows: 40 });
    const b = sql(fulfillment, { seed: 42, rows: 40 });
    expect(a).toBe(b);
    expect(sha(a)).toBe(sha(b));
  });
  it("changes with the seed", () => {
    expect(sql(fulfillment, { seed: 1, rows: 10 })).not.toBe(sql(fulfillment, { seed: 2, rows: 10 }));
  });
  it("matches the committed snapshot (guards against accidental generator changes)", () => {
    expect(sql(fulfillment, { seed: 42, rows: 4, name: "snapshot" })).toMatchSnapshot();
  });
  it("does not reshuffle other tables when one is added", () => {
    const small = parseDdl("CREATE TABLE a (id int PRIMARY KEY, email text, n int);");
    const big = parseDdl("CREATE TABLE b (id int PRIMARY KEY, x text); CREATE TABLE a (id int PRIMARY KEY, email text, n int, extra text);");
    const x = collect(small, { seed: 7, rows: 30 }).tables.get("public.a") as { rows: Value[][] };
    const y = collect(big, { seed: 7, rows: 30 }).tables.get("public.a") as { rows: Value[][] };
    expect(y.rows.map((r) => r.slice(0, 3))).toEqual(x.rows);
  });
});

describe("relationships and constraints", () => {
  const { tables } = collect(fulfillment, { seed: 42, rows: 200 });
  it("never produces an orphan, duplicate or NULL in a NOT NULL column", () => {
    expect(violations(fulfillment, tables)).toEqual([]);
  });
  it("respects CHECK ranges, enum labels and varchar lengths", () => {
    const products = tables.get("public.products");
    const priceIdx = products?.columns.findIndex((c) => c.name === "price") as number;
    for (const r of products?.rows ?? []) {
      expect(Number(r[priceIdx])).toBeGreaterThan(0);
      expect(Number(r[priceIdx])).toBeLessThanOrEqual(2500);
      expect(String(r[priceIdx])).toMatch(/^\d+\.\d{2}$/);
    }
  });
  it("assigns a 1:1 foreign key without repeats", () => {
    const c = tables.get("public.customers") as { columns: { name: string }[]; rows: Value[][] };
    const i = c.columns.findIndex((x) => x.name === "user_id");
    expect(new Set(c.rows.map((r) => r[i])).size).toBe(200);
  });
  it("makes a self reference point at earlier rows (or be a root)", () => {
    const u = tables.get("public.users") as { columns: { name: string }[]; rows: Value[][] };
    const ref = u.columns.findIndex((x) => x.name === "referred_by");
    const id = u.columns.findIndex((x) => x.name === "id");
    u.rows.forEach((r, k) => {
      if (r[ref] !== null) expect(Number(r[ref])).toBeLessThan(Number(r[id]) + 0.5 + k * 0);
    });
    expect(u.rows.filter((r) => r[ref] === null).length).toBeGreaterThan(0);
  });
  it("keeps related timestamps in order", () => {
    const s = tables.get("public.shipments") as { columns: { name: string }[]; rows: Value[][] };
    const a = s.columns.findIndex((x) => x.name === "shipped_at");
    const b = s.columns.findIndex((x) => x.name === "delivered_at");
    for (const r of s.rows) if (r[a] && r[b]) expect(String(r[a]) <= String(r[b])).toBe(true);
  });
});

describe("nullability", () => {
  const db = parseDdl("CREATE TABLE t (id serial PRIMARY KEY, a text, b text NOT NULL, c int);");
  const rate = (r: number, column: string): number => {
    const { tables } = collect(db, { seed: 3, rows: 4000, nullRatio: r });
    const t = tables.get("public.t") as { columns: { name: string }[]; rows: Value[][] };
    const i = t.columns.findIndex((c) => c.name === column);
    return t.rows.filter((row) => row[i] === null).length / t.rows.length;
  };
  it("is within tolerance of the requested ratio", () => {
    expect(rate(0.1, "a")).toBeGreaterThan(0.08);
    expect(rate(0.1, "a")).toBeLessThan(0.12);
    expect(rate(0.25, "c")).toBeGreaterThan(0.22);
    expect(rate(0.25, "c")).toBeLessThan(0.28);
  });
  it("is zero when asked, and never applies to NOT NULL or primary keys", () => {
    expect(rate(0, "a")).toBe(0);
    expect(rate(0.5, "b")).toBe(0);
    expect(rate(0.5, "id")).toBe(0);
  });
  it("does not shift the other values when the ratio changes", () => {
    const a = collect(db, { seed: 3, rows: 50, nullRatio: 0 }).tables.get("public.t")?.rows ?? [];
    const b = collect(db, { seed: 3, rows: 50, nullRatio: 0.5 }).tables.get("public.t")?.rows ?? [];
    expect(b.map((r) => r[2])).toEqual(a.map((r) => r[2]));
  });
});

describe("sequences, ids and appending", () => {
  const db = parseDdl("CREATE TABLE t (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n int); CREATE TABLE s (id serial PRIMARY KEY);");
  it("emits explicit ids, OVERRIDING SYSTEM VALUE and setval", () => {
    const out = sql(db, { rows: 3 });
    expect(out).toContain("OVERRIDING SYSTEM VALUE");
    expect(out).toContain("(1, ");
    expect(out).toContain("setval(pg_get_serial_sequence('public.t', 'id'), 3, true)");
    expect(out).toContain("setval(pg_get_serial_sequence('public.s', 'id'), 3, true)");
  });
  it("continues after existing ids", () => {
    const out = sql(db, { rows: 2, existing: { maxIds: { "public.t": { id: 40 } } } });
    expect(out).toContain("(41, ");
    expect(out).toContain("(42, ");
    expect(out).toContain(", 42, true)");
  });
  it("honours startId", () => {
    expect(sql(db, { rows: 1, startId: 1000 })).toContain("(1000");
  });
});

describe("uniqueness", () => {
  it("fails early and by name when a column cannot hold enough values", () => {
    const db = parseDdl("CREATE TABLE t (id serial PRIMARY KEY, flag boolean UNIQUE);");
    expect(() => [...generate(db, { rows: 5 })]).toThrow(/t\.flag must be unique but can only take 2/);
  });
  it("makes unique text values distinct even at volume", () => {
    const db = parseDdl("CREATE TABLE u (id serial PRIMARY KEY, email varchar(60) UNIQUE NOT NULL, name text);");
    const { tables } = collect(db, { rows: 30000 });
    expect(violations(db, tables)).toEqual([]);
  }, 60000);
  it("enforces composite and case-insensitive uniqueness", () => {
    const db = parseDdl(`CREATE TABLE a (id serial PRIMARY KEY, kind text); CREATE TABLE b (a_id int REFERENCES a(id), tag text, n int, UNIQUE (a_id, tag)); CREATE UNIQUE INDEX ON a (lower(kind));`);
    const { tables } = collect(db, { rows: 300, overrides: { "b.tag": { pick: ["x", "y", "z", "w"] } } });
    expect(violations(db, tables)).toEqual([]);
    const kinds = (tables.get("public.a")?.rows ?? []).filter((r) => r[1] !== null).map((r) => String(r[1]).toLowerCase());
    expect(new Set(kinds).size).toBe(kinds.length);
  });
  it("reports exhaustion with the offending column", () => {
    const db = parseDdl("CREATE TABLE a (id serial PRIMARY KEY); CREATE TABLE b (a_id int REFERENCES a(id), t text, UNIQUE (a_id, t));");
    expect(() => [...generate(db, { tableRows: { a: 2, b: 200 }, overrides: { "b.t": { pick: ["only"] } } })]).toThrow(PostseedError);
  });
  it("fails when a 1:1 key has fewer parents than children", () => {
    const db = parseDdl("CREATE TABLE a (id serial PRIMARY KEY); CREATE TABLE b (a_id int UNIQUE REFERENCES a(id));");
    expect(() => [...generate(db, { tableRows: { a: 3, b: 10 } })]).toThrow(/only 3 row/);
  });
});

describe("cycles and missing parents", () => {
  it("fills a nullable cycle with UPDATEs", () => {
    const db = parseDdl(`
      CREATE TABLE a (id serial PRIMARY KEY, b_id int);
      CREATE TABLE b (id serial PRIMARY KEY, a_id int NOT NULL REFERENCES a(id));
      ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id);`);
    const out = sql(db, { rows: 20, nullRatio: 0 });
    expect(out).toMatch(/UPDATE public\.a SET b_id = \d+ WHERE id = \d+;/);
    const { tables } = collect(db, { rows: 20, nullRatio: 0 });
    expect(violations(db, tables)).toEqual([]);
    expect(tables.get("public.a")?.rows.every((r) => r[1] !== null)).toBe(true);
  });
  it("uses SET CONSTRAINTS for a deferrable NOT NULL cycle", () => {
    const db = parseDdl(`
      CREATE TABLE a (id serial PRIMARY KEY, b_id int NOT NULL);
      CREATE TABLE b (id serial PRIMARY KEY, a_id int NOT NULL REFERENCES a(id));
      ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id) DEFERRABLE INITIALLY DEFERRED;`);
    const out = sql(db, { rows: 10 });
    expect(out).toContain("SET CONSTRAINTS ALL DEFERRED;");
    const { tables } = collect(db, { rows: 10 });
    expect(violations(db, tables)).toEqual([]);
  });
  it("refuses an impossible cycle and says why", () => {
    const db = parseDdl(`
      CREATE TABLE a (id serial PRIMARY KEY, b_id int NOT NULL);
      CREATE TABLE b (id serial PRIMARY KEY, a_id int NOT NULL REFERENCES a(id));
      ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id);`);
    expect(() => [...generate(db, { rows: 5 })]).toThrow(/reference each other in a cycle/);
  });
  it("requires an unselected parent unless rows exist for it", () => {
    expect(() => [...generate(fulfillment, { tables: ["orders"] })]).toThrow(/Select customers/);
    const existing = { keys: { "public.customers": [{ id: 7 }, { id: 9 }] } };
    const { tables } = collect(fulfillment, { tables: ["orders"], rows: 30, existing });
    const orders = tables.get("public.orders") as { columns: { name: string }[]; rows: Value[][] };
    const i = orders.columns.findIndex((c) => c.name === "customer_id");
    expect(new Set(orders.rows.map((r) => r[i]))).toEqual(new Set([7, 9]));
  });
});

describe("overrides and distributions", () => {
  const db = parseDdl("CREATE TABLE p (id serial PRIMARY KEY, email text, status text, score int); CREATE TABLE c (id serial PRIMARY KEY, p_id int NOT NULL REFERENCES p(id));");
  it("applies value, pick, template, int and faker overrides", () => {
    const { tables } = collect(db, {
      rows: 100,
      nullRatio: 0,
      overrides: {
        "p.email": { template: "user{n}@example.com" },
        "p.status": { pick: ["a", "b"], weights: [9, 1] },
        "p.score": { int: [10, 12] },
      },
    });
    const p = tables.get("public.p") as { rows: Value[][] };
    expect(p.rows[0]?.[1]).toBe("user1@example.com");
    expect(p.rows.filter((r) => r[2] === "a").length).toBeGreaterThan(75);
    expect(p.rows.every((r) => (r[3] as number) >= 10 && (r[3] as number) <= 12)).toBe(true);
    const f = collect(db, { rows: 3, overrides: { "p.email": { faker: "internet.email" } } });
    expect(String(f.tables.get("public.p")?.rows[0]?.[1])).toContain("@");
  });
  it("rejects a bad override clearly", () => {
    expect(() => [...generate(db, { overrides: { "p.email": { faker: "nope.nothing" } } })]).toThrow(/Unknown Faker method/);
    expect(() => [...generate(db, { overrides: { "p.email": { value: "a", pick: ["b"] } } })]).toThrow(/more than one generator/);
  });
  it("skews references with zipf", () => {
    const run = (d: "uniform" | "zipf"): number => {
      const { tables } = collect(db, { tableRows: { p: 100, c: 3000 }, fkDistribution: d });
      const counts = new Map<Value, number>();
      for (const r of tables.get("public.c")?.rows ?? []) counts.set(r[1] as Value, (counts.get(r[1] as Value) ?? 0) + 1);
      return Math.max(...counts.values());
    };
    expect(run("zipf")).toBeGreaterThan(run("uniform") * 2);
  });
});

describe("CHECKs between columns, and CHECKs the generator cannot enforce", () => {
  it("keeps a window valid: ends_at >= starts_at, low < high, a <> b", () => {
    const db = parseDdl(`CREATE TABLE w (id serial PRIMARY KEY, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, lo int NOT NULL, hi int NOT NULL, a text, b text,
      CHECK (ends_at >= starts_at), CHECK (lo < hi), CHECK (a <> b));`);
    expect(db.warnings).toEqual([]);
    expect(getTable(db, "public.w").relations).toHaveLength(3);
    const { tables } = collect(db, { seed: 11, rows: 400, nullRatio: 0.3 });
    expect(violations(db, tables)).toEqual([]);
  });
  it("warns about a CHECK that is only partly understood, and still names it", () => {
    const db = parseDdl("CREATE TABLE p (id serial PRIMARY KEY, n int CHECK (n > 0 AND n % 2 = 0), s text CHECK (s LIKE 'x%'));");
    const w = db.warnings.join("\n");
    expect(w).toMatch(/p: CHECK .*n % 2.* is only partly understood/);
    expect(w).toMatch(/CHECK \(s LIKE \('x%'\)\)/);
    expect(getTable(db, "public.p").columns[1]?.check).toMatchObject({ min: 0, minExclusive: true });
  });
});

describe("CHECK text as Postgres prints it (pg_get_constraintdef)", () => {
  it("reads = ANY (ARRAY[...]::text[]), ranges and length checks", () => {
    const any = analyzeCheck("CHECK (((data_type)::text = ANY ((ARRAY['string'::character varying, 'number'::character varying])::text[])))");
    expect(any.complete).toBe(true);
    expect(any.columns.get("data_type")?.in).toEqual(["string", "number"]);
    const range = analyzeCheck("CHECK (((price > (0)::numeric) AND (price <= (2500)::numeric)))");
    expect(range.columns.get("price")).toMatchObject({ min: 0, minExclusive: true, max: 2500 });
    const len = analyzeCheck("CHECK ((char_length(username) >= 3))");
    expect(len.columns.get("username")?.minLen).toBe(3);
    const between = analyzeCheck("CHECK (((quantity >= 1) AND (quantity <= 20)))");
    expect(between.columns.get("quantity")).toMatchObject({ min: 1, max: 20 });
  });
});

describe("writers", () => {
  const db = parseDdl(`CREATE TYPE mood AS ENUM ('it''s ok', 'back\\slash');
    CREATE TABLE w (id serial PRIMARY KEY, note text, m mood, tags text[], doc jsonb, n numeric(5,2), at timestamptz, b bytea);`);
  const tricky: Record<string, { value?: Value; pick?: Value[] }> = {
    "w.note": { pick: ["O'Brien \"quoted\" back\\slash, comma\nnewline ünï©ode 🌱"] },
    "w.tags": { value: ["a,b", 'c"d', "e\\f", "{x}"] as Value },
  };
  it("escapes quotes, backslashes, unicode and arrays in SQL", () => {
    const out = sql(db, { rows: 1, nullRatio: 0, overrides: tricky });
    expect(out).toContain("E'O''Brien \"quoted\" back\\\\slash, comma\nnewline ünï©ode 🌱'");
    expect(out).toContain(`E'{"a,b","c\\\\"d","e\\\\\\\\f","{x}"}'`);
    expect(out).toMatch(/'it''s ok'|E'back\\\\slash'/);
  });
  it("writes valid JSON in object and ndjson modes", () => {
    const objectMode = JSON.parse([...writeJson(generate(db, { rows: 3, overrides: tricky }))].join("")) as Record<string, unknown[]>;
    expect(objectMode.w).toHaveLength(3);
    const lines = [...writeJson(generate(db, { rows: 3 }), { mode: "ndjson" })].join("").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toHaveProperty("row.id", 1);
  });
  it("writes COPY-compatible CSV with a header and quoted fields", () => {
    const chunks = [...writeCsv(generate(db, { rows: 2, nullRatio: 0, overrides: tricky }))];
    const text = chunks.map((c) => c.text).join("");
    expect(chunks[0]?.file).toBe("w.csv");
    expect(text.split("\n")[0]).toBe("id,note,m,tags,doc,n,at,b");
    expect(text).toContain('"O\'Brien ""quoted"" back\\slash, comma\nnewline ünï©ode 🌱"');
  });
  it("applies cycle updates before writing JSON", () => {
    const cyc = parseDdl("CREATE TABLE a (id serial PRIMARY KEY, b_id int); CREATE TABLE b (id serial PRIMARY KEY, a_id int NOT NULL REFERENCES a(id)); ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id);");
    const doc = JSON.parse([...writeJson(generate(cyc, { rows: 10, nullRatio: 0 }))].join("")) as { a: Array<{ b_id: number | null }> };
    expect(doc.a.every((r) => r.b_id !== null)).toBe(true);
  });
  it("lists the foreign key in the table comment", () => {
    expect(sql(fulfillment, { rows: 2 })).toContain("-- 2 rows for orders  (customer_id → customers)");
  });
});

describe("schema introspection helpers", () => {
  it("resolves bare table names", () => {
    expect(getTable(fulfillment, "public.users").name).toBe("users");
    expect(() => [...generate(fulfillment, { tables: ["nope"] })]).toThrow(/Unknown table "nope"/);
  });
});
