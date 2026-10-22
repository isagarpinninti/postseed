# @postseed/pg

The Node-only PostgreSQL layer of [Postseed](https://github.com/isagarpinninti/postseed).

```bash
npm install @postseed/core @postseed/pg
```

```ts
import { generate } from "@postseed/core";
import { connect, introspect, insertEvents, loadExisting } from "@postseed/pg";

const client = await connect(process.env.DATABASE_URL!);
const db = await introspect(client, ["public"]);              // reads pg_catalog, not information_schema
const existing = await loadExisting(client, db, ["public.orders"]);
const result = await insertEvents(client, generate(db, { seed: 42, rows: 100, tables: ["orders"], existing }), { dryRun: true });
console.log(result.totalRows, "rows validated, nothing changed");
await client.end();
```

- `introspect` returns the same model `parseDdl` builds, including enums, composite foreign keys, partial unique indexes and CHECK-derived limits.
- `insertEvents` writes in **one transaction**: any failure rolls back and throws an `InsertError` naming the table, row and constraint. `dryRun` does everything and rolls back (sequences are left untouched). Tables over 1,000 rows use `COPY`.
- Connection strings are never logged; `redactUrl` and `redactText` mask passwords.

MIT licensed.
