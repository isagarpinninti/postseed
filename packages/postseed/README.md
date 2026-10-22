<div align="center">

# Postseed

**Realistic Postgres seed data. In seconds.**

Paste a schema or point at your database. Postseed respects your foreign keys, enums and uniqueness, and never leaves your machine.

[![CI](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml/badge.svg)](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/postseed?label=npm)](https://www.npmjs.com/package/postseed)
[![PyPI](https://img.shields.io/pypi/v/postseed?label=PyPI)](https://pypi.org/project/postseed/)
[![Gem](https://img.shields.io/gem/v/postseed?label=RubyGems)](https://rubygems.org/gems/postseed)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](https://github.com/isagarpinninti/postseed/blob/main/LICENSE)

</div>

```bash
npx postseed
```

<p align="center">
  <img src="https://github.com/isagarpinninti/postseed/raw/main/apps/web/public/screens/02-studio.png" alt="Postseed Studio: tables, settings and the generated SQL" width="860">
</p>

## Why

Seed data is usually either a hand-written script that rots, or a faker call that produces rows your database rejects: orphaned foreign keys, duplicate unique values, strings longer than the column, enum labels that do not exist. Postseed reads your schema and generates data that is **relationship-correct by construction**, the same every time, and inserted in one transaction.

- **Relationship-correct.** Tables are ordered parents first and every foreign key points at a real parent row. Composite keys, self-references and even foreign-key cycles are handled. Unique columns stay unique. Enums only get valid labels, `varchar(n)` stays within `n`, `numeric(p,s)` keeps its precision, and the CHECK constraints it understands are respected.
- **Deterministic.** The same schema, seed and version give byte-identical output on any machine. Regenerate fixtures in CI instead of committing them; report a bug as "seed 8123".
- **Transactional.** Inserts are all-or-nothing. A failure rolls everything back and names the table, row and constraint. A **dry run** does the real inserts, validates every constraint against your actual database, then rolls back.
- **Local-first.** No account, no upload, no telemetry. Studio listens on `127.0.0.1` behind a one-time token, and the only network connection it ever makes is to your own database.
- **Three ways in.** A web **Studio**, a scriptable **CLI**, and an in-browser **Playground** (a static site where your schema never leaves the page).

## Quickstart

You need Node.js 20 or newer. For Studio and the CLI nothing else is required.

```bash
npx postseed                                  # Studio on 127.0.0.1, opens your browser
```

Connect to a database, choose tables, press **Generate**, then copy, download, or **Insert into DB** (try the **Dry run** first).

No database yet? Open the **Templates** tab for four starter schemas (e-commerce, multi-tenant SaaS, blog and CMS, fintech ledger), or use the CLI with a `CREATE TABLE` script:

```bash
npx postseed generate --schema ./schema.sql --rows 50 --seed 42 --out seed.sql
psql "$DATABASE_URL" -f seed.sql
```

Or go straight from your database to your database:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/mydb"
npx postseed insert --dry-run        # validate everything, then roll back
npx postseed insert --yes            # insert for real, in one transaction
```

| Command | What it does |
| --- | --- |
| `postseed` | Start Studio |
| `postseed generate` | Write SQL, JSON or CSV for a schema file or a live database |
| `postseed insert` | Generate and insert in one transaction (`--dry-run`, `--truncate`) |
| `postseed introspect` | Show the tables, keys and enums Postseed sees |
| `postseed init` | Write a starter `postseed.config.ts` |

Exit codes: `0` ok, `1` error, `2` usage, `3` a dry run found a violation. The [configuration reference](https://github.com/isagarpinninti/postseed/blob/main/docs/CONFIG.md) lists every flag.

## Other languages

The same engine is published for Python and Ruby (it runs with Node.js 20+, which must be on your `PATH`):

```bash
pip install postseed        # also: postseed.generate("CREATE TABLE ...", rows=50, seed=42)
gem install postseed        # also: Postseed.generate("CREATE TABLE ...", rows: 50, seed: 42)
```

Output is identical across npm, PyPI and RubyGems.

## Configuration

```ts
// postseed.config.ts   (npx postseed init)
import { defineConfig } from "postseed";

export default defineConfig({
  rows: 50,
  tableRows: { orders: 500 },
  nullRatio: 0.1,
  overrides: {
    "users.email": { template: "user{n}@example.com" },
    "orders.status": { pick: ["paid", "shipped"], weights: [3, 1] },
  },
});
```

Column names guide the data (`email`, `first_name`, `price`, `*_at`, `is_*` and many more), then the column type does, and related timestamps stay in order (`updated_at` is never before `created_at`). See [Configuration](https://github.com/isagarpinninti/postseed/blob/main/docs/CONFIG.md).

## How it stays safe

| Concern | What Postseed does |
| --- | --- |
| Your credentials | Never logged; shown as `postgres://user:•••@host`; saved connections live in a `0600` file inside a `0700` folder, and saving is optional |
| Studio on your machine | `127.0.0.1` only, a per-launch token, strict Host and Origin checks, no CORS, a strict content security policy |
| Writing to a database | One transaction; dry run first; insert only the exact settings you previewed |
| `TRUNCATE` | Opt-in, shows what `CASCADE` would also empty, and needs the database name typed in full |
| Remote or production-looking databases | A loud warning and a name confirmation |

Read the full [security model](https://github.com/isagarpinninti/postseed/blob/main/docs/SECURITY_MODEL.md), including the least-privilege role to seed with.

## Documentation

[Quickstart](https://github.com/isagarpinninti/postseed/blob/main/docs/QUICKSTART.md) · [Configuration](https://github.com/isagarpinninti/postseed/blob/main/docs/CONFIG.md) · [Determinism](https://github.com/isagarpinninti/postseed/blob/main/docs/DETERMINISM.md) · [Security model](https://github.com/isagarpinninti/postseed/blob/main/docs/SECURITY_MODEL.md) · [FAQ](https://github.com/isagarpinninti/postseed/blob/main/docs/FAQ.md) · [Architecture](https://github.com/isagarpinninti/postseed/blob/main/docs/ARCHITECTURE.md) · [Decisions](https://github.com/isagarpinninti/postseed/blob/main/docs/DECISIONS.md)

## What is in this repository

| Path | What it is |
| --- | --- |
| [`packages/core`](https://github.com/isagarpinninti/postseed/blob/main/packages/core) | `@postseed/core`: the engine. Browser-safe (no Node APIs): schema model, DDL parser, FK-aware planner, deterministic generators, SQL/JSON/CSV writers |
| [`packages/pg`](https://github.com/isagarpinninti/postseed/blob/main/packages/pg) | `@postseed/pg`: Node-only. `pg_catalog` introspection, the transactional inserter with dry run, local connection and history store |
| [`packages/postseed`](https://github.com/isagarpinninti/postseed/blob/main/packages/postseed) | `postseed`: the CLI and the local Studio server (what `npx postseed` runs) |
| [`packages/studio`](https://github.com/isagarpinninti/postseed/blob/main/packages/studio) | The Studio web app (React, built to static files and bundled into `postseed`) |
| [`apps/web`](https://github.com/isagarpinninti/postseed/blob/main/apps/web) | The website: landing page, in-browser Playground, documentation (Next.js, static export) |
| [`wrappers`](https://github.com/isagarpinninti/postseed/blob/main/wrappers) | The PyPI and RubyGems packages |

## Development

```bash
pnpm install
pnpm gates          # typecheck, lint, test, build, end-to-end
pnpm bench          # performance budget
pnpm smoke          # pack, install into an empty folder, run the real CLI and Studio
```

Database tests need PostgreSQL: they start a throwaway cluster if `initdb` is installed, or use `POSTSEED_TEST_DATABASE_URL`. See [CONTRIBUTING](https://github.com/isagarpinninti/postseed/blob/main/CONTRIBUTING.md).

## Honest limits

- PostgreSQL only. Versions 15 to 18 are in the CI matrix.
- English data only in this version.
- CHECK constraints are understood when they compare columns with constants or with each other; anything more complex is generated unconstrained, listed as a note in Studio, and caught by the dry run.
- Types without a sensible generator (geometric, range, full-text) are left to their default or NULL; override them if you need values.
- Partitioned tables are written through the parent, so a partition (or a default partition) must exist for the generated dates.
- Output depends on the Postseed version: pin it exactly if you commit expectations about the data.

## License

MIT © Sagar Pinninti. See [LICENSE](https://github.com/isagarpinninti/postseed/blob/main/LICENSE).
