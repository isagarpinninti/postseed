# Changelog

## 0.1.0: Initial release

First public release of Postseed.

- **`@postseed/core`**: a browser-safe engine. Schema model, DDL parser that turns unsupported statements into warnings, foreign-key-aware planner (cycles via NULL-then-UPDATE or deferred constraints), deterministic per-column generators, uniqueness with bounded retries, CHECK-aware values (including checks between two columns), related-timestamp ordering, and streaming SQL, JSON and CSV writers.
- **`@postseed/pg`**: `pg_catalog` introspection, a transactional inserter (single transaction, `COPY` above 1,000 rows, dry run, sequence `setval`, opt-in `TRUNCATE`), row-level failure reporting, and a private local store for connections and history.
- **`postseed`**: the CLI (`generate`, `insert`, `introspect`, `init`) with exit codes `0`, `1`, `2`, `3`, and Studio, a local web app served on `127.0.0.1` behind a one-time token with Host and Origin checks.
- **Studio**: connect, choose tables, preview deterministic output, copy or download (SQL, JSON, CSV zip), dry run and insert with live progress, history with re-run, command palette, dark and light themes, and four starter templates that work without a database.
- **Website**: landing page, an in-browser Playground (the real engine in a Web Worker), and documentation.
- **PyPI and RubyGems packages** that bundle the same engine and run it with Node.js, with `postseed.generate` / `Postseed.generate` helpers.
- Tested against PostgreSQL 15 to 18 in CI, with a corpus of 24 real-world-style schemas, random-schema property tests, byte-for-byte determinism snapshots, and Playwright accessibility checks.
