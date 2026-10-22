import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATES, generate, parseDdl, writeSql } from "../src";
import { collect, violations } from "./helpers";

describe("templates", () => {
  it("includes the four starter schemas", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["ecommerce", "saas", "blog", "fintech"]);
  });
  it("keeps the e-commerce template identical to examples/fulfillment.sql", () => {
    const file = readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8");
    expect(file.endsWith(TEMPLATES[0]?.sql ?? "?")).toBe(true);
  });
  for (const t of TEMPLATES) {
    it(`${t.name}: parses without warnings and generates valid data`, () => {
      const db = parseDdl(t.sql);
      expect(db.warnings).toEqual([]);
      expect(db.tables.length).toBeGreaterThanOrEqual(5);
      const { tables } = collect(db, { seed: 42, rows: t.recommendedRows });
      expect(violations(db, tables)).toEqual([]);
      expect([...writeSql(generate(db, { rows: 3 }))].join("")).toContain("COMMIT;");
    });
  }
});
