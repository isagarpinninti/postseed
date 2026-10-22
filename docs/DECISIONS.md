# Decisions

One line per decision that the spec left open. Newest last.

- **Monorepo tooling:** pnpm 10 workspaces + Turborepo + Changesets. `typescript` is pinned to `~5.9` by a workspace override because TypeScript 7 has no compiler API and `tsup`'s declaration build needs one.
- **DDL parsing:** `pgsql-ast-parser` rejects whole scripts on one unsupported statement and does not know `DEFERRABLE`, `PARTITION BY`, `WITH (...)`, `CREATE DOMAIN`. Postseed splits the script itself, normalises those clauses, parses statement by statement, and turns every failure into a warning (never a crash). `CREATE DOMAIN` is read by a small dedicated parser.
- **Reference date:** relative timestamps ("within the last 2 years") are anchored to the constant `2026-01-01T00:00:00Z`, not the clock, so the same schema + seed + version is byte-identical on any day. `--now` / `now` overrides it. The constant moves only in a release, noted in the changelog.
- **Per-column streams:** every column gets its own PRNG and Faker instance seeded from `hash(seed, table, column)`, and the NULL decision has its own stream. Adding a table or column, or changing `nullRatio`, never reshuffles other values.
- **Faker:** exact-pinned (`10.6.0`); upgrading it is a deliberate, changelogged change because it changes output. Text uses Faker's English word and company generators, not `lorem` (which is Latin).
- **Value model:** NUMERIC and MONEY are generated as exact decimal strings (no float noise). JSON columns hold objects, arrays hold arrays; each writer formats them (SQL literal, JSON, CSV, COPY text).
- **NULL vs uniqueness:** a retry after a uniqueness clash never answers with NULL (NULLs are distinct in Postgres, so that would silently "pass"). It re-draws; after 6 attempts text values get a deterministic row-number suffix; after 50 the run fails naming the column.
- **Cycles:** nullable foreign keys are inserted as NULL and filled by `UPDATE`; otherwise deferrable keys use a placeholder under `SET CONSTRAINTS ALL DEFERRED` then `UPDATE`; otherwise generation fails and says which tables. The table needs a primary key for the UPDATE. Self-references: the first 10% of rows are roots (NULL, or pointing at themselves when the column is NOT NULL).
- **Theme:** the master prompt's green accent is replaced by Assentra's monochrome palette (near-black / white / slate, amber only on the seed mark), per the request to match Assentra. Layout and screens are as specified.
- **Dry run and sequences:** `setval` is not transactional, so a dry run skips it; a rolled-back dry run leaves sequences untouched.
- **COPY vs INSERT:** tables above 1000 rows use `COPY ... FROM STDIN`; `GENERATED ALWAYS` identity tables use `INSERT ... OVERRIDING SYSTEM VALUE` regardless of size.
- **Driver values as text:** the `pg` client is configured to return every value as text, and Postseed converts what it needs, so types never depend on driver parsers.
- **Integration tests without Docker:** testcontainers needs Docker, which is not available on the development machine. The suites run against a throwaway local cluster (`initdb`) or `POSTSEED_TEST_DATABASE_URL`; CI runs the Postgres 15/16/17/18 matrix with service containers.
- **Locale:** only `en` ships in v1; other locales would add megabytes to the browser bundle.
- **Config loading:** `postseed.config.ts` is loaded with `jiti`, so TypeScript configs work without a build step.
- **Truncate safety in the CLI:** `--truncate` is never satisfied by `--yes`; it needs the database name (typed, or `--confirm-database`). Production-looking names need the same confirmation.
