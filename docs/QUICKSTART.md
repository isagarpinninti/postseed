# Quickstart

Postseed generates realistic seed data for PostgreSQL that is always relationship-correct: no orphan rows, no broken uniqueness, valid enums. It runs on your machine. Nothing is uploaded and there is no account.

You need Node.js 20 or newer and a PostgreSQL database (or just a `CREATE TABLE` script).

## 1. Open Studio

```bash
npx postseed
```

Studio starts on `127.0.0.1` (a random free port) and opens your browser. Connect with a connection string such as `postgres://user:password@localhost:5432/mydb`, choose the tables, set rows and a seed, and press **Generate**. Then copy or download the result, or **Insert into DB**.

The Insert dialog offers a **Dry run**: it inserts everything, checks every constraint against your real database, then rolls back. Run it first.

No database yet? Open the **Templates** tab: four starter schemas (e-commerce, multi-tenant SaaS, blog and CMS, fintech ledger) generate right in the page.

## 2. Or use the command line

Generate from a schema file, no database needed:

```bash
npx postseed generate --schema ./schema.sql --rows 50 --seed 42 --out ./seed.sql
```

Generate from a live database (reads tables, enums and keys from `pg_catalog`):

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/mydb"
npx postseed generate --tables users,orders --rows 200 --format json
```

Insert straight into a database, in one transaction:

```bash
npx postseed insert --dry-run        # validate, then roll back
npx postseed insert --yes            # really insert
```

Prefer the `DATABASE_URL` environment variable to `--url`: command-line arguments are visible to other users on the same machine.

## 3. Use it in CI and tests

The same schema, seed and Postseed version always produce byte-identical output, so a seed file can be regenerated instead of committed:

```bash
npx postseed generate --schema ./db/schema.sql --rows 25 --seed 7 --out ./test/fixtures/seed.sql
psql "$DATABASE_URL" -f ./test/fixtures/seed.sql
```

Pin the version in `package.json` (`postseed` exact, not a range) if you rely on identical output across upgrades. See [Determinism](DETERMINISM.md).

## 4. Configure it

```bash
npx postseed init
```

writes `postseed.config.ts`. See the [Configuration reference](CONFIG.md) for rows per table, null ratio, and per-column overrides.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | An error (connection, generation, a failed insert) |
| 2 | Usage error (a bad flag, a missing schema) |
| 3 | A dry run found a violation |

## Supported databases

PostgreSQL only. Postgres 15 to 18 are covered by the automated test matrix; 14 works too. Postseed reads `pg_catalog`, not `information_schema`, because the latter hides enums, composite foreign keys and partial unique indexes.
