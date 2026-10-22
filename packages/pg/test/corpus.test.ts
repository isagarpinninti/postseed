import { readFileSync, readdirSync } from "node:fs";
import { generate, parseDdl, splitStatements, tableKey } from "@postseed/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, countRows, insertEvents, introspect } from "../src";
import { HAS_PG, startPostgres, type TestServer } from "./pgserver";

/**
 * The corpus of real-world-style schemas, against a real database: each one is loaded as SQL, read back
 * through pg_catalog, and filled with generated data in one transaction. This proves both halves of the model
 * (parsed DDL and introspection) agree, and that the data survives the database's own constraints.
 */
const dir = new URL("../../core/test/corpus/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let server: TestServer;
beforeAll(async () => {
  if (HAS_PG) server = await startPostgres();
}, 90_000);
afterAll(async () => {
  await server?.stop();
});

/** Statements a plain connection should not run: data blocks and session tweaks from pg_dump. */
const runnable = (s: string): boolean => !/^copy\b/i.test(s) && !/^select\s+pg_catalog\./i.test(s) && !/^insert\s+into\b/i.test(s) && !/^set\s/i.test(s);

describe.skipIf(!HAS_PG)("corpus on a real PostgreSQL", () => {
  let n = 0;
  for (const file of files) {
    it(`${file}: loads, introspects the same model, and accepts generated data`, async () => {
      const sql = readFileSync(new URL(file, dir), "utf8");
      const url = await server.createDatabase(`corpus_${Date.now().toString(36)}_${n++}`);
      const client = await connect(url);
      try {
        for (const s of splitStatements(sql).filter(runnable)) {
          try {
            await client.query(s);
          } catch (e) {
            // An extension that is not installed is the one acceptable reason to skip a statement.
            if (!/extension|could not open extension control file/i.test((e as Error).message)) throw new Error(`${file}: ${s.slice(0, 80)} -> ${(e as Error).message}`, { cause: e });
          }
        }
        const parsed = parseDdl(sql);
        const real = await introspect(client, ["public"]);
        expect(real.tables.map((t) => t.name).sort(), "tables").toEqual(parsed.tables.map((t) => t.name).sort());
        for (const t of parsed.tables) {
          const r = real.tables.find((x) => x.name === t.name);
          expect(r?.primaryKey, `${t.name} primary key`).toEqual(t.primaryKey);
          expect(r?.foreignKeys.length, `${t.name} foreign keys`).toBe(t.foreignKeys.length);
          for (const c of t.columns) {
            const rc = r?.columns.find((x) => x.name === c.name);
            expect(rc?.type.kind, `${t.name}.${c.name} type`).toBe(c.type.kind);
            expect(rc?.nullable, `${t.name}.${c.name} nullable`).toBe(c.nullable);
          }
        }
        const selected = real.tables.map(tableKey);
        const result = await insertEvents(client, generate(real, { seed: 9, rows: 25 }));
        expect(result.committed).toBe(true);
        const counts = await countRows(client, real, selected);
        for (const k of selected) expect(counts[k], k).toBe(25);
        // The very same data inserts from the parsed model too (fresh database).
        const url2 = await server.createDatabase(`corpus_${Date.now().toString(36)}_${n++}`);
        const c2 = await connect(url2);
        try {
          for (const s of splitStatements(sql).filter(runnable)) await c2.query(s).catch(() => undefined);
          const again = await insertEvents(c2, generate(parsed, { seed: 9, rows: 25 }));
          expect(again.committed).toBe(true);
        } finally {
          await c2.end();
        }
      } finally {
        await client.end();
      }
    }, 120_000);
  }
});
