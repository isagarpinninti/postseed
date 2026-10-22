# Architecture

Postseed is one engine with three front ends.

```
            ┌──────────────────────────────── @postseed/core (no Node APIs) ───────────────────────────────┐
 DDL text ──▶ parseDdl ─┐                                                                                   │
                        ├─▶ Database (IR) ─▶ planTables ─▶ generate (events) ─▶ writeSql / writeJson / writeCsv
 live DB ──▶ introspect ┘   (tables, columns,   (parents first,   (deterministic,
   (@postseed/pg)           keys, enums)         cycles broken)     streaming)
            └────────────────────────────────────────────────────────────────────────────────────────────┘
                                                        │
              ┌─────────────────────────────────────────┼───────────────────────────────────────────┐
              ▼                                         ▼                                           ▼
        Playground (browser,                      CLI (`postseed`)                           Studio (React, served by
        Web Worker, no server)                    generate / insert / introspect             the CLI's local Hono server)
                                                        │                                           │
                                                        └─────────▶ insertEvents (one transaction, dry run, COPY) ◀─┘
```

## The schema model

Both sources produce the same intermediate representation (`Database`): tables with columns, primary key, unique constraints, foreign keys (composite and deferrable), enums, CHECK-derived limits and column-to-column relations.

- **From DDL.** `pgsql-ast-parser` is strict and rejects a whole script on one unsupported statement, so the script is split into statements, `DEFERRABLE` and `PARTITION BY` clauses are normalised, and each statement is parsed on its own. Whatever cannot be understood becomes a warning and is skipped. `CREATE DOMAIN` has its own small parser.
- **From a database.** Queries against `pg_catalog` (`pg_class`, `pg_attribute`, `pg_constraint`, `pg_enum`, `pg_index`), not `information_schema`, which loses enums, composite foreign keys and partial unique indexes.

A test loads 24 real-world-style schemas into a real PostgreSQL and checks that both paths describe the same model and that generated data is accepted.

## The planner

Foreign keys form a graph. Strongly connected components (Tarjan) find cycles. Within a cycle, a nullable key is inserted as NULL and filled by an `UPDATE`; otherwise a deferrable key is inserted with a placeholder under `SET CONSTRAINTS ALL DEFERRED` and then updated; otherwise the selection cannot be inserted and the error names the tables. The rest is a stable topological sort, parents first. Self-references are not graph edges: the first 10 percent of rows are roots and the others point at earlier rows.

## Generation

`generate()` is a synchronous generator of events (`begin`, `table`, `rows`, `table-end`, `updates`, `end`), so writers and the inserter stream and memory stays flat. For each table it builds slots: one per foreign key and one per remaining column.

- **Determinism.** Each column has its own random stream (and its own Faker instance) derived from `hash(seed, table, column)`; NULL decisions have a separate stream. Nothing reads the clock.
- **Resolution.** Override, foreign key, enum, sequential id, column name, column type, then nullability.
- **Uniqueness.** Seen-sets per unique constraint. A clash re-draws only the columns involved (never answering with NULL); after six attempts text gets a deterministic suffix; after fifty the run fails naming the column. Domains known to be too small fail before any row is generated.
- **Related values.** Timestamps in a chain stay ordered, and CHECKs between two columns are enforced by ordering or nudging the pair.

## Writers

SQL (a transactional script with explicit column lists, `OVERRIDING SYSTEM VALUE`, `setval`), JSON (object or NDJSON) and CSV (one file per table, in the dialect `COPY ... CSV` reads). Rows are formatted per column type, with escaping covered by tests.

## Studio and its server

A Hono server bound to `127.0.0.1` serves the built React app and a small JSON/SSE API. Every request is checked for the Host header, the Origin header and a per-launch token. Insert requires a token issued with a preview of exactly the settings being inserted. The app is bundled into the `postseed` package, and the PyPI and RubyGems packages bundle the same files.

## Testing

Unit and property tests (random schemas through the whole pipeline), snapshot tests for determinism, the schema corpus against a real PostgreSQL, integration tests for the inserter, server tests for the security checks, and Playwright end-to-end tests with accessibility checks for Studio and the website. CI runs the database suites on PostgreSQL 15, 16, 17 and 18.
