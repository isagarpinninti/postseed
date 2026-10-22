import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generate, parseDdl, writeSql } from "../src";
import { collect, violations } from "./helpers";

/** A random but valid schema: tables in order, foreign keys to earlier tables, plus optional self references. */
const schemaArb = fc
  .record({
    tables: fc.integer({ min: 1, max: 6 }),
    seedBits: fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 40, maxLength: 40 }),
  })
  .map(({ tables, seedBits }) => {
    let b = 0;
    const next = (m: number): number => (seedBits[b++ % seedBits.length] as number) % m;
    const ddl: string[] = ["CREATE TYPE tone AS ENUM ('calm', 'warm', 'sharp');"];
    for (let i = 0; i < tables; i++) {
      const cols: string[] = [];
      const pkKind = next(3);
      cols.push(pkKind === 0 ? "id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY" : pkKind === 1 ? "id serial PRIMARY KEY" : "id uuid PRIMARY KEY");
      const fkCount = i === 0 ? 0 : next(3);
      for (let f = 0; f < fkCount; f++) {
        const target = next(i);
        const isUuid = ddl.some((d) => d.startsWith(`CREATE TABLE t${target} (id uuid`));
        const type = isUuid ? "uuid" : "bigint";
        const nullable = next(2) === 0 ? "" : " NOT NULL";
        const unique = next(5) === 0 ? " UNIQUE" : "";
        cols.push(`ref${f} ${type}${nullable}${unique} REFERENCES t${target}(id)`);
      }
      const selfRef = next(3) === 0;
      if (selfRef) cols.push(`parent_id ${pkKind === 2 ? "uuid" : "bigint"}${next(2) === 0 ? "" : " NOT NULL"}`);
      cols.push(`email varchar(${20 + next(40)}) ${next(2) === 0 ? "UNIQUE" : ""}`.trim());
      cols.push("mood tone" + (next(2) === 0 ? " NOT NULL" : ""));
      cols.push("score int CHECK (score BETWEEN 3 AND 9)");
      cols.push("price numeric(8,2) CHECK (price > 0)");
      cols.push(`created_at timestamptz${next(2) === 0 ? " NOT NULL" : ""}`);
      ddl.push(`CREATE TABLE t${i} (${cols.join(", ")});`);
      if (selfRef) ddl.push(`ALTER TABLE t${i} ADD FOREIGN KEY (parent_id) REFERENCES t${i}(id);`);
    }
    return ddl.join("\n");
  });

describe("random schemas", () => {
  it("never violate relationships, uniqueness, enums or CHECK ranges", () => {
    fc.assert(
      fc.property(schemaArb, fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 0, max: 60 }), (ddl, seed, rows) => {
        const db = parseDdl(ddl);
        expect(db.warnings).toEqual([]);
        // 1:1 foreign keys need as many parents as children, so keep the counts equal.
        const { tables } = collect(db, { seed, rows, nullRatio: 0.2 });
        expect(violations(db, tables)).toEqual([]);
      }),
      { numRuns: 120 },
    );
  });

  it("is deterministic for any schema and seed", () => {
    fc.assert(
      fc.property(schemaArb, fc.integer({ min: 1, max: 99999 }), (ddl, seed) => {
        const db = parseDdl(ddl);
        const a = [...writeSql(generate(db, { seed, rows: 15 }))].join("");
        const b = [...writeSql(generate(parseDdl(ddl), { seed, rows: 15 }))].join("");
        expect(a).toBe(b);
      }),
      { numRuns: 40 },
    );
  });
});
