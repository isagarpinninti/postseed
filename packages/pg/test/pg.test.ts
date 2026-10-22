import { readFileSync } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, parseDdl, prepare, tableKey, type Database } from "@postseed/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConnectionError, addHistory, connect, countRows, coerce, friendlyConnectionError, insertEvents, InsertError, introspect,
  isLocalHost, listConnections, listHistory, loadExisting, redactText, redactUrl, saveConnection, testConnection, truncateImpact,
} from "../src";
import { HAS_PG, startPostgres, type TestServer } from "./pgserver";

const fulfillmentSql = readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8");
const local = parseDdl(fulfillmentSql);

let server: TestServer;
beforeAll(async () => {
  if (HAS_PG) server = await startPostgres();
}, 90_000);
afterAll(async () => {
  await server?.stop();
});

let counter = 0;
async function freshDb(ddl = fulfillmentSql): Promise<{ url: string; client: Awaited<ReturnType<typeof connect>>; db: Database }> {
  const url = await server.createDatabase(`t${Date.now().toString(36)}${counter++}`);
  const client = await connect(url);
  await client.query(ddl);
  return { url, client, db: await introspect(client, ["public"]) };
}

describe("redaction and errors (no database needed)", () => {
  it("hides passwords everywhere", () => {
    expect(redactUrl("postgres://me:s3cr3t@db.example.com:5432/app?sslmode=require")).toBe("postgres://me:•••@db.example.com:5432/app?sslmode=require");
    expect(redactText('connect failed for "postgresql://u:p%40ss@h/db": nope')).not.toContain("p%40ss");
  });
  it("maps driver errors to actionable ones", () => {
    expect(friendlyConnectionError({ code: "28P01", message: "password authentication failed for user x" })).toMatchObject({ code: "AUTH" });
    expect(friendlyConnectionError({ code: "3D000", message: 'database "x" does not exist' })).toMatchObject({ code: "NO_DATABASE" });
    expect(friendlyConnectionError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND h" })).toMatchObject({ code: "DNS" });
    expect(friendlyConnectionError({ code: "ECONNREFUSED", message: "x" })).toMatchObject({ code: "REFUSED" });
    expect(friendlyConnectionError({ message: "The server does not support SSL connections" })).toMatchObject({ code: "SSL" });
    expect(friendlyConnectionError({ message: "Connection terminated due to connection timeout" })).toMatchObject({ code: "TIMEOUT" });
  });
  it("rejects a malformed URL without trying the network", async () => {
    await expect(testConnection("not-a-url")).rejects.toBeInstanceOf(ConnectionError);
  });
  it("tells local hosts from remote ones", () => {
    expect(isLocalHost("postgres://u@localhost/db")).toBe(true);
    expect(isLocalHost("postgres://u@127.0.0.1/db")).toBe(true);
    expect(isLocalHost("postgres://u@db.prod.example.com/db")).toBe(false);
  });
  it("computes what TRUNCATE ... CASCADE would also empty", () => {
    expect(truncateImpact(local, ["public.users"]).sort()).toEqual(["public.customers", "public.inventory", "public.order_items", "public.orders", "public.payments", "public.shipments"].filter((k) => k !== "public.inventory").sort());
  });
  it("coerces driver text to generator values", () => {
    const col = (kind: string) => ({ type: { kind } }) as never;
    expect(coerce("42", col("bigint"))).toBe(42);
    expect(coerce("t", col("bool"))).toBe(true);
    expect(coerce("12.50", col("numeric"))).toBe("12.50");
    expect(coerce(null, col("int"))).toBeNull();
  });
});

describe.skipIf(!HAS_PG)("local files", () => {
  it("stores connections privately and history without passwords", async () => {
    process.env.POSTSEED_HOME = await mkdtemp(join(tmpdir(), "postseed-home-"));
    const saved = await saveConnection({ name: "Local", url: "postgres://me:hunter2@localhost:5432/app" });
    expect((await stat(process.env.POSTSEED_HOME)).mode & 0o777).toBe(0o700);
    expect((await stat(join(process.env.POSTSEED_HOME, "connections.json"))).mode & 0o777).toBe(0o600);
    expect((await listConnections())[0]?.id).toBe(saved.id);
    await addHistory({ connectionName: "Local", connectionUrl: "postgres://me:hunter2@localhost:5432/app", tables: ["users"], rows: 10, seed: 1, format: "sql", action: "download", settings: { rowsPerTable: 10, nullRatio: 0.1 } });
    const history = await listHistory();
    expect(JSON.stringify(history)).not.toContain("hunter2");
    expect(history[0]?.connection).toBe("postgres://me:•••@localhost:5432/app");
    expect((await stat(join(process.env.POSTSEED_HOME, "history.json"))).mode & 0o777).toBe(0o600);
  });
});

describe.skipIf(!HAS_PG)("against a real Postgres", () => {
  it("reports friendly errors for a wrong database and a refused port", async () => {
    const bad = (() => { const u = new URL(server.url); u.pathname = "/does_not_exist"; return u.toString(); })();
    await expect(testConnection(bad)).rejects.toMatchObject({ code: "NO_DATABASE" });
    await expect(testConnection("postgres://postgres:x@127.0.0.1:1/postgres")).rejects.toMatchObject({ code: "REFUSED" });
  });

  it("introspects the same model the DDL parser produces", async () => {
    const { client, db } = await freshDb();
    try {
      expect(db.warnings).toEqual([]);
      expect(db.tables.map(tableKey).sort()).toEqual(local.tables.map(tableKey).sort());
      expect(db.enums.map((e) => [e.name, e.values])).toEqual(local.enums.map((e) => [e.name, e.values]));
      for (const t of local.tables) {
        const real = db.tables.find((x) => x.name === t.name);
        expect(real, t.name).toBeDefined();
        expect(real?.primaryKey).toEqual(t.primaryKey);
        expect(real?.foreignKeys.map((f) => [f.columns, f.refTable, f.refColumns])).toEqual(t.foreignKeys.map((f) => [f.columns, f.refTable, f.refColumns]));
        expect((real?.uniques ?? []).map((u) => u.columns.join(",")).sort()).toEqual(t.uniques.map((u) => u.columns.join(",")).sort());
        for (const c of t.columns) {
          const rc = real?.columns.find((x) => x.name === c.name);
          expect(rc?.type.kind, `${t.name}.${c.name}`).toBe(c.type.kind);
          expect(rc?.nullable, `${t.name}.${c.name} nullable`).toBe(c.nullable);
          expect(rc?.identity, `${t.name}.${c.name} identity`).toBe(c.identity);
          expect(rc?.serial, `${t.name}.${c.name} serial`).toBe(c.serial);
          expect(rc?.check?.min, `${t.name}.${c.name} check`).toBe(c.check?.min);
          expect(rc?.check?.max).toBe(c.check?.max);
        }
      }
    } finally {
      await client.end();
    }
  });

  it("inserts a whole schema in one transaction with no orphans, duplicates or sequence drift", async () => {
    const { client, db } = await freshDb();
    try {
      const events = generate(db, { seed: 42, rows: 300, copyThreshold: undefined } as never);
      const result = await insertEvents(client, events, { copyThreshold: 100 });
      expect(result.committed).toBe(true);
      expect(result.totalRows).toBe(300 * db.tables.length);
      const counts = await countRows(client, db, db.tables.map(tableKey));
      for (const k of Object.keys(counts)) expect(counts[k], k).toBe(300);
      // Every foreign key resolves (the database enforces this; confirm it independently).
      const orphans = await client.query(`SELECT count(*)::int AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE c.id IS NULL`);
      expect(Number(orphans.rows[0].n)).toBe(0);
      const dupes = await client.query(`SELECT count(*)::int AS n FROM (SELECT email FROM users GROUP BY email HAVING count(*) > 1) d`);
      expect(Number(dupes.rows[0].n)).toBe(0);
      // Sequences continue after the generated ids: a normal insert gets 301.
      const next = await client.query(`INSERT INTO orders (customer_id, status, total, placed_at) VALUES (1, 'pending', 1, now()) RETURNING id`);
      expect(next.rows[0].id).toBe("301");
      const ident = await client.query(`INSERT INTO users (email, full_name) VALUES ('x@y.z', 'X') RETURNING id`);
      expect(ident.rows[0].id).toBe("301");
    } finally {
      await client.end();
    }
  }, 60_000);

  it("dry run validates, changes nothing and leaves sequences alone", async () => {
    const { client, db } = await freshDb();
    try {
      const result = await insertEvents(client, generate(db, { seed: 1, rows: 50 }), { dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.committed).toBe(false);
      expect(Object.values(await countRows(client, db, db.tables.map(tableKey))).every((n) => n === 0)).toBe(true);
      const id = await client.query(`INSERT INTO users (email, full_name) VALUES ('a@b.c', 'A') RETURNING id`);
      expect(id.rows[0].id).toBe("1");
    } finally {
      await client.end();
    }
  });

  it("rolls everything back and names the table, row and constraint when something fails", async () => {
    const { client, db } = await freshDb();
    try {
      const events = generate(db, { seed: 5, rows: 20, overrides: { "products.price": { pick: [10, 10, 10, -5] } } });
      const failure = await insertEvents(client, events, {}).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(InsertError);
      const err = failure as InsertError;
      expect(err.details.table).toBe("products");
      expect(err.details.constraint).toBe("products_price_check");
      expect(err.details.rowIndex).toBeGreaterThan(0);
      expect(err.message).toContain("products");
      expect(Object.values(await countRows(client, db, db.tables.map(tableKey))).every((n) => n === 0)).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("truncates only when asked and restarts identities", async () => {
    const { client, db } = await freshDb();
    try {
      await insertEvents(client, generate(db, { seed: 1, rows: 10 }));
      await insertEvents(client, generate(db, { seed: 2, rows: 5 }), { truncate: true });
      expect((await countRows(client, db, ["public.users"]))["public.users"]).toBe(5);
      const min = await client.query(`SELECT min(id)::int AS m FROM users`);
      expect(Number(min.rows[0].m)).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("appends to existing data: ids continue, uniques avoid collisions, parents are sampled from the database", async () => {
    const { client, db } = await freshDb();
    try {
      await insertEvents(client, generate(db, { seed: 1, rows: 40 }));
      const selected = ["public.orders", "public.users"];
      const existing = await loadExisting(client, db, selected);
      expect(existing.maxIds?.["public.orders"]?.id).toBe(40);
      expect(existing.keys?.["public.customers"]).toHaveLength(40);
      const second = await insertEvents(client, generate(db, { seed: 2, rows: 25, tables: selected, existing, nullRatio: 0 }));
      expect(second.committed).toBe(true);
      const counts = await countRows(client, db, selected);
      expect(counts["public.orders"]).toBe(65);
      expect(counts["public.users"]).toBe(65);
      const max = await client.query(`SELECT max(id)::int AS m FROM orders`);
      expect(Number(max.rows[0].m)).toBe(65);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("fills foreign-key cycles, both nullable and deferrable", async () => {
    const ddl = `
      CREATE TABLE a (id serial PRIMARY KEY, b_id int);
      CREATE TABLE b (id serial PRIMARY KEY, a_id int NOT NULL REFERENCES a(id));
      ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b(id);
      CREATE TABLE c (id serial PRIMARY KEY, d_id int NOT NULL);
      CREATE TABLE d (id serial PRIMARY KEY, c_id int NOT NULL REFERENCES c(id));
      ALTER TABLE c ADD FOREIGN KEY (d_id) REFERENCES d(id) DEFERRABLE INITIALLY DEFERRED;`;
    const { client, db } = await freshDb(ddl);
    try {
      expect(prepare(db, { tables: ["a", "b", "c", "d"] }).errors).toEqual([]);
      const result = await insertEvents(client, generate(db, { rows: 30, nullRatio: 0 }));
      expect(result.committed).toBe(true);
      const a = await client.query(`SELECT count(*)::int AS n FROM a WHERE b_id IS NULL`);
      expect(Number(a.rows[0].n)).toBe(0);
      const c = await client.query(`SELECT count(*)::int AS n FROM c JOIN d ON d.id = c.d_id`);
      expect(Number(c.rows[0].n)).toBe(30);
    } finally {
      await client.end();
    }
  });

  it("uses COPY above the threshold and handles awkward text", async () => {
    const ddl = `CREATE TABLE t (id serial PRIMARY KEY, note text, tags text[], doc jsonb, n numeric(6,2), at timestamptz, b bytea, flag boolean);`;
    const { client, db } = await freshDb(ddl);
    try {
      const nasty = "tab\there, quote' dq\" back\\slash \n newline ünï©ode 🌱";
      const events = generate(db, { rows: 2500, nullRatio: 0, overrides: { "t.note": { pick: [nasty] } } });
      const result = await insertEvents(client, events, { copyThreshold: 1000 });
      expect(result.totalRows).toBe(2500);
      const r = await client.query(`SELECT DISTINCT note FROM t`);
      expect(r.rows).toEqual([{ note: nasty }]);
      expect(Number((await client.query(`SELECT count(*)::int AS n FROM t WHERE jsonb_typeof(doc) = 'object' AND array_length(tags, 1) > 0`)).rows[0].n)).toBe(2500);
    } finally {
      await client.end();
    }
  });
});
