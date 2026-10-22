# postseed (Ruby)

[![Gem Version](https://img.shields.io/gem/v/postseed)](https://rubygems.org/gems/postseed)
[![CI](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml/badge.svg)](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](https://github.com/isagarpinninti/postseed/blob/main/LICENSE)

**Realistic Postgres seed data. In seconds.** Postseed generates seed data that respects your foreign keys, enums and uniqueness, never leaves your machine, and is deterministic: the same schema, seed and version give byte-identical output.

This gem bundles the [Postseed](https://github.com/isagarpinninti/postseed) engine and runs it with **Node.js 20 or newer** (it must be on your `PATH`, or set `POSTSEED_NODE`). Nothing else to install.

```bash
gem install postseed
postseed            # opens Studio, the local web app, on 127.0.0.1
```

## Command line

```bash
postseed generate --schema schema.sql --rows 50 --seed 42 --out seed.sql
postseed insert --url "$DATABASE_URL" --dry-run     # validate against your database, then roll back
postseed insert --url "$DATABASE_URL" --yes         # really insert, in one transaction
```

See the [documentation](https://github.com/isagarpinninti/postseed#readme) for every option.

## From Ruby

```ruby
require "postseed"

sql = Postseed.generate(<<~SQL, rows: 25, seed: 42)
  CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
  CREATE TABLE posts (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), title text);
SQL
# `sql` is a transactional script: every post points at a real user, every email is unique.
```

`Postseed.generate(schema_sql, rows: 50, seed: 42, format: "sql", tables: nil, table_rows: nil, null_ratio: nil, now: nil)`
returns the text (`format` is `"sql"` or `"json"`) and raises `Postseed::Error` with the engine's message if it
cannot. The same arguments always return the same text.

`Postseed.run(args, input: nil)` runs any CLI command and returns `[stdout, stderr, status]`.

In a Rails project, generate fixtures from `db/structure.sql`:

```bash
postseed generate --schema db/structure.sql --rows 25 --seed 7 --out db/seeds.sql
```

## Notes

- Ruby 2.6 or newer. The gem is pure Ruby plus a bundled JavaScript engine, so there is one gem for every platform.
- It is the same engine as the `postseed` npm package and the `postseed` Python package, so output is identical across all three.
- MIT licensed.
