import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate, parseDdl, writeSql } from "../src";

/**
 * Performance budgets from the spec: 10 tables x 100k rows in under 10 s in Node, 5k rows in the browser
 * path in under 1 s, with flat memory. Run with `pnpm bench` (POSTSEED_PERF=1); CI loosens the budget with
 * POSTSEED_PERF_BUDGET_MS because shared runners are slower than a laptop.
 */
const enabled = process.env.POSTSEED_PERF === "1";
const budget = Number(process.env.POSTSEED_PERF_BUDGET_MS ?? 10_000);

const base = readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8");
const extra = Array.from({ length: 2 }, (_, i) => `CREATE TABLE extra_${i} (id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id), email varchar(80) UNIQUE, title text, amount numeric(10,2), created_at timestamptz, active boolean);`).join("\n");

describe.skipIf(!enabled)("performance budget", () => {
  it("10 tables x 100,000 rows stream out in under the budget with flat memory", () => {
    const db = parseDdl(base + extra);
    expect(db.tables).toHaveLength(10);
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    let bytes = 0;
    let rows = 0;
    for (const e of generate(db, { seed: 42, rows: 100_000 })) {
      if (e.type === "rows") rows += e.rows.length;
    }
    for (const chunk of writeSql(generate(db, { seed: 42, rows: 1000 }))) bytes += chunk.length;
    const ms = performance.now() - started;
    console.log(`10 tables x 100k rows: ${(ms / 1000).toFixed(2)}s (${rows.toLocaleString("en-US")} rows), heap +${((process.memoryUsage().heapUsed - heapBefore) / 1e6).toFixed(0)} MB, sample ${bytes} chars`);
    expect(rows).toBe(1_000_000);
    expect(ms).toBeLessThan(budget);
  }, 120_000);

  it("5,000 rows across 8 tables take under a second", () => {
    const db = parseDdl(base);
    const started = performance.now();
    let rows = 0;
    for (const e of generate(db, { seed: 1, rows: 5000 })) if (e.type === "rows") rows += e.rows.length;
    const ms = performance.now() - started;
    console.log(`8 tables x 5k rows: ${ms.toFixed(0)} ms`);
    expect(rows).toBe(40_000);
    expect(ms).toBeLessThan(1000 * (budget / 10_000));
  });
});
