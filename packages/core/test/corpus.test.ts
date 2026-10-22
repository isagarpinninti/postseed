import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate, parseDdl, writeSql } from "../src";
import { collect, violations } from "./helpers";

/**
 * A corpus of real-world-style schemas: what pg_dump, Rails, Django, Prisma, Laravel, TypeORM, Sequelize and
 * Supabase actually emit, plus the shapes people really have (composite keys, trees, cycles, partitions,
 * polymorphic and EAV tables). Every one must parse, and data generated for it must satisfy every constraint.
 */
const dir = new URL("./corpus/", import.meta.url);

interface Expect {
  tables: string[];
  enums?: number;
  /** Warnings that are expected and fine; any other warning fails the test. */
  warns?: RegExp[];
}

const manifest: Record<string, Expect> = {
  "01-pgdump-blog.sql": { tables: ["authors", "posts", "comments"], enums: 1 },
  "02-rails-structure.sql": { tables: ["accounts", "users", "projects", "tasks", "schema_migrations"] },
  "03-django-shop.sql": { tables: ["django_content_type", "auth_user", "shop_category", "shop_product", "shop_order", "shop_orderitem"] },
  "04-prisma-saas.sql": { tables: ["Organization", "User", "Membership", "Invoice"], enums: 2 },
  "05-laravel-cms.sql": { tables: ["users", "categories", "articles", "tags", "article_tag", "failed_jobs"] },
  "06-typeorm-uuid.sql": { tables: ["user", "project", "issue", "project_members_user"], enums: 1 },
  "07-supabase-profiles.sql": { tables: ["profiles", "todos", "messages", "channels"] },
  "08-pagila-subset.sql": { tables: ["language", "film", "actor", "film_actor", "category", "film_category"], enums: 1 },
  "09-chinook-subset.sql": { tables: ["artist", "album", "media_type", "genre", "track", "employee", "customer", "invoice", "invoice_line", "playlist", "playlist_track"] },
  "10-northwind-subset.sql": { tables: ["categories", "customers", "employees", "suppliers", "products", "orders", "order_details"] },
  "11-multitenant-composite.sql": { tables: ["tenants", "customers", "invoices", "invoice_lines"] },
  "12-ledger-generated.sql": { tables: ["accounts", "journal_entries", "entry_lines"] },
  "13-hr-tree.sql": { tables: ["departments", "employees", "timesheets"], enums: 1 },
  "14-partitioned-events.sql": { tables: ["devices", "events"], warns: [/partition/i] },
  "15-hasura-todo.sql": { tables: ["users", "todos"] },
  "16-forum.sql": { tables: ["users", "categories", "topics", "posts", "post_likes", "user_badges"] },
  "17-gitlab-like.sql": { tables: ["namespaces", "users", "projects", "merge_requests", "issues"] },
  "18-sequelize-camel.sql": { tables: ["Users", "Posts", "Likes"] },
  "19-clinic-composite.sql": { tables: ["clinics", "patients", "clinicians", "appointments", "prescriptions"], enums: 1 },
  "20-iot-timeseries.sql": { tables: ["sites", "sensors", "readings", "alerts"] },
  "21-school.sql": { tables: ["students", "teachers", "courses", "enrollments", "prerequisites"] },
  "22-polymorphic-eav.sql": { tables: ["posts", "photos", "comments", "entities", "attributes", "entity_values"] },
  "23-cyclic-teams.sql": { tables: ["teams", "members", "projects"] },
  "24-airline.sql": { tables: ["airports", "aircraft", "flights", "passengers", "bookings"] },
};

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

describe("DDL corpus", () => {
  it("has at least 20 schemas, all of them listed here", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files).toEqual(Object.keys(manifest).sort());
  });

  for (const file of files) {
    const want = manifest[file] as Expect;
    describe(file, () => {
      const db = parseDdl(readFileSync(new URL(file, dir), "utf8"));

      it("parses to the expected tables without unexpected warnings", () => {
        expect(db.tables.map((t) => t.name)).toEqual(want.tables);
        expect(db.enums).toHaveLength(want.enums ?? 0);
        const unexpected = db.warnings.filter((w) => !(want.warns ?? []).some((re) => re.test(w)));
        expect(unexpected).toEqual([]);
      });

      it("resolves every foreign key to a real parent column", () => {
        for (const t of db.tables) {
          for (const fk of t.foreignKeys) {
            const parent = db.tables.find((p) => p.schema === fk.refSchema && p.name === fk.refTable);
            expect(parent, `${t.name} -> ${fk.refTable}`).toBeDefined();
            expect(fk.refColumns.length, `${t.name}(${fk.columns}) refs`).toBe(fk.columns.length);
            for (const c of fk.refColumns) expect(parent?.columns.some((x) => x.name === c), `${fk.refTable}.${c}`).toBe(true);
          }
        }
      });

      it("generates data that satisfies every constraint, deterministically", () => {
        const { tables } = collect(db, { seed: 5, rows: 25 });
        expect(violations(db, tables)).toEqual([]);
        const a = [...writeSql(generate(db, { seed: 5, rows: 25 }))].join("");
        expect(a).toBe([...writeSql(generate(parseDdl(readFileSync(new URL(file, dir), "utf8")), { seed: 5, rows: 25 }))].join(""));
        expect(a).toContain("COMMIT;");
      });
    });
  }
});
