# postseed (Python)

[![PyPI](https://img.shields.io/pypi/v/postseed)](https://pypi.org/project/postseed/)
[![CI](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml/badge.svg)](https://github.com/isagarpinninti/postseed/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](https://github.com/isagarpinninti/postseed/blob/main/LICENSE)

**Realistic Postgres seed data. In seconds.** Postseed generates seed data that respects your foreign keys, enums and uniqueness, never leaves your machine, and is deterministic: the same schema, seed and version give byte-identical output.

This package bundles the [Postseed](https://github.com/isagarpinninti/postseed) engine and runs it with **Node.js 20 or newer** (it must be on your `PATH`, or set `POSTSEED_NODE`). Nothing else to install.

```bash
pip install postseed
postseed            # opens Studio, the local web app, on 127.0.0.1
```

## Command line

```bash
postseed generate --schema schema.sql --rows 50 --seed 42 --out seed.sql
postseed insert --url "$DATABASE_URL" --dry-run     # validate against your database, then roll back
postseed insert --url "$DATABASE_URL" --yes         # really insert, in one transaction
```

See the [documentation](https://github.com/isagarpinninti/postseed#readme) for every option.

## From Python

```python
import postseed

sql = postseed.generate(
    """
    CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
    CREATE TABLE posts (id serial PRIMARY KEY, user_id int NOT NULL REFERENCES users(id), title text);
    """,
    rows=25,
    seed=42,
)
# `sql` is a transactional script: every post points at a real user, every email is unique.
```

`generate(schema_sql, *, rows=50, seed=42, format="sql", tables=None, table_rows=None, null_ratio=None, now=None)`
returns the text (`format` is `"sql"` or `"json"`) and raises `postseed.PostseedError` with the engine's message
if it cannot. The same arguments always return the same text.

`postseed.run(args, input=None)` runs any CLI command and returns a `subprocess.CompletedProcess`.

## Notes

- Python 3.8 or newer. The package is pure Python plus a bundled JavaScript engine, so there is one wheel for every platform.
- It is the same engine as the `postseed` npm package and the `postseed` gem, so output is identical across all three.
- MIT licensed.
