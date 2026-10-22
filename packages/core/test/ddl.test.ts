import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDdl, splitStatements, getTable } from "../src";

const fulfillment = readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8");

describe("splitStatements", () => {
  it("ignores semicolons in strings, dollar quotes and comments", () => {
    const s = splitStatements(`
      -- a; comment
      CREATE TABLE a (x text DEFAULT 'a;b');
      /* b; */ SELECT $$ x; y $$;
      INSERT INTO a VALUES ('it''s;');`);
    expect(s).toHaveLength(3);
    expect(s[1]).toContain("$$ x; y $$");
  });
  it("skips COPY ... FROM stdin data", () => {
    const s = splitStatements("COPY t (a) FROM stdin;\n1;2\n\\.\nCREATE TABLE b (id int);");
    expect(s.map((x) => x.split(" ")[0])).toEqual(["COPY", "CREATE"]);
  });
});

describe("parseDdl", () => {
  const db = parseDdl(fulfillment);
  it("reads every table, enum and relationship", () => {
    expect(db.warnings).toEqual([]);
    expect(db.tables.map((t) => t.name)).toEqual([
      "users", "customers", "products", "orders", "order_items", "payments", "shipments", "inventory",
    ]);
    expect(db.enums.map((e) => [e.name, e.values.length])).toEqual([["order_status", 6], ["payment_type", 4]]);
    const items = getTable(db, "public.order_items");
    expect(items.primaryKey).toEqual(["order_id", "product_id"]);
    expect(items.foreignKeys.map((f) => f.refTable)).toEqual(["orders", "products"]);
    expect(items.columns.find((c) => c.name === "quantity")?.check).toMatchObject({ min: 1, max: 20 });
  });
  it("classifies identity, serial, enums, numeric and arrays", () => {
    const users = getTable(db, "public.users");
    expect(users.columns[0]).toMatchObject({ identity: "always", nullable: false });
    expect(getTable(db, "public.customers").columns[0]).toMatchObject({ serial: true });
    const orders = getTable(db, "public.orders");
    expect(orders.columns.find((c) => c.name === "status")?.type).toMatchObject({ kind: "enum", enumKey: "public.order_status" });
    const products = getTable(db, "public.products");
    expect(products.columns.find((c) => c.name === "price")).toMatchObject({ type: { kind: "numeric", precision: 10, scale: 2 }, check: { min: 0, minExclusive: true, max: 2500 } });
    expect(products.columns.find((c) => c.name === "tags")?.type).toMatchObject({ kind: "text", array: 1 });
    expect(users.uniques).toEqual([{ columns: ["email"] }]);
  });
  it("handles pg_dump style ALTER TABLE, deferrable keys, domains and unsupported statements", () => {
    const d = parseDdl(`
      CREATE DOMAIN pos AS integer CHECK (VALUE > 0);
      CREATE TABLE a (id integer NOT NULL, n pos, b_id integer) PARTITION BY RANGE (id);
      CREATE TABLE b (id integer NOT NULL, a_id integer);
      CREATE SEQUENCE a_id_seq;
      ALTER TABLE ONLY a ALTER COLUMN id SET DEFAULT nextval('a_id_seq'::regclass);
      ALTER TABLE ONLY a ADD CONSTRAINT a_pkey PRIMARY KEY (id);
      ALTER TABLE ONLY b ADD CONSTRAINT b_pkey PRIMARY KEY (id);
      ALTER TABLE ONLY a ADD CONSTRAINT a_b FOREIGN KEY (b_id) REFERENCES b (id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE ONLY b ADD CONSTRAINT b_a FOREIGN KEY (a_id) REFERENCES a (id);
      CREATE UNIQUE INDEX b_lower ON b (lower(a_id::text));
      CREATE TABLE weird (x int) WITH (fillfactor = 70);`);
    const a = getTable(d, "public.a");
    expect(a.columns[0]).toMatchObject({ serial: true, nullable: false });
    expect(a.columns[1]).toMatchObject({ type: { kind: "int", domain: "pos" }, check: { min: 0, minExclusive: true } });
    expect(a.foreignKeys[0]).toMatchObject({ refTable: "b", deferrable: true });
    expect(getTable(d, "public.b").foreignKeys[0]?.deferrable).toBe(false);
    expect(d.warnings.some((w) => /partitioned/.test(w))).toBe(true);
    expect(d.warnings.some((w) => /expression that is not supported/.test(w))).toBe(true);
    expect(getTable(d, "public.weird").columns).toHaveLength(1);
  });
  it("reports bad statements as warnings instead of throwing", () => {
    const d = parseDdl("CREATE TABLE ok (id int); CREATE TABLE broken (id int,, x);");
    expect(d.tables.map((t) => t.name)).toEqual(["ok"]);
    expect(d.warnings).toHaveLength(1);
  });
});
