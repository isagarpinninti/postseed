# @postseed/core

The engine behind [Postseed](https://github.com/isagarpinninti/postseed): realistic, relationship-correct, deterministic seed data for PostgreSQL. **Browser-safe**: no Node APIs, so it also runs in a Web Worker.

```bash
npm install @postseed/core
```

```ts
import { parseDdl, generate, writeSql } from "@postseed/core";

const db = parseDdl(`
  CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
  CREATE TABLE posts (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), title text);
`);

for (const chunk of writeSql(generate(db, { seed: 42, rows: 25 }))) process.stdout.write(chunk);
```

- `parseDdl(sql)` builds the schema model; statements it cannot understand become `db.warnings` instead of errors.
- `generate(db, options)` is a synchronous generator of events, so output streams and memory stays flat. The same schema, options and version always give the same events.
- `writeSql`, `writeJson` and `writeCsv` turn events into text. `prepare(db, options)` plans a selection and reports what would stop it, without generating.
- To read a live database use [`@postseed/pg`](https://www.npmjs.com/package/@postseed/pg), which produces the same model.

See the [documentation](https://github.com/isagarpinninti/postseed#readme). MIT licensed.
