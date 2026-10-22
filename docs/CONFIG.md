# Configuration reference

Configuration lives in `postseed.config.ts` (or `.mts`, `.js`, `.mjs`, `.cjs`, `.json`) in the directory you run Postseed from. Create one with `npx postseed init`. Command-line flags always win over the file.

```ts
import { defineConfig } from "postseed";

export default defineConfig({
  rows: 50,
  tableRows: { orders: 500 },
  nullRatio: 0.1,
  seed: 42,
  locale: "en",
  fkDistribution: "uniform",
  overrides: {
    "users.email": { template: "user{n}@example.com" },
    "orders.status": { pick: ["paid", "shipped"], weights: [3, 1] },
  },
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rows` | number | 50 | Rows generated per table |
| `tableRows` | object | none | Row count for individual tables, by `table` or `schema.table` |
| `nullRatio` | number from 0 to 1 | 0.1 | Chance that a nullable column is NULL. Primary keys and NOT NULL columns are never NULL |
| `seed` | integer | 42 | The root seed. Same schema, seed and version give identical output |
| `locale` | `"en"` | `"en"` | Only English ships in this version |
| `tables` | list | all | Only generate these tables |
| `dbSchema` | string | `public` | Database schema (or comma-separated schemas) to read when connecting |
| `fkDistribution` | `uniform` or `zipf` | `uniform` | How child rows pick parents. `zipf` makes a few parents popular, like real data |
| `overrides` | object | none | Replace how a column is generated (below) |

## Overrides

Keys are `table.column` (or `schema.table.column`). Set at most one generator per column.

| Field | Example | Result |
| --- | --- | --- |
| `value` | `{ value: "active" }` | The same value in every row |
| `pick` | `{ pick: ["a", "b"] }` | A random item; add `weights: [3, 1]` to skew it |
| `int` | `{ int: [1, 5] }` | An integer between the two numbers, inclusive |
| `float` | `{ float: [5, 500], decimals: 2 }` | A decimal in the range |
| `faker` | `{ faker: "internet.email" }` | A Faker method by path; pass `args: [...]` if it takes any |
| `template` | `{ template: "user{n}@example.com" }` | Text where `{n}` is the 1-based row number |
| `nullRatio` | `{ nullRatio: 0.5 }` | Changes only how often this column is NULL. Works alone or together with a generator |

A bad override (an unknown Faker path, two generators at once) stops the run with a message naming the column.

## How values are chosen

For every column, the first rule that applies wins:

1. an override
2. a foreign key (a value taken from a real parent row)
3. an enum (a valid label)
4. an identity or serial column (sequential ids that continue after existing ones)
5. the column name: `email`, `first_name`, `phone`, `city`, `country`, `url`, `slug`, `title`, `description`, `price`, `amount`, `quantity`, `status`, `is_*`, `*_at`, `ip` and many more
6. the column type: integers, `numeric(p,s)` with the right precision, `varchar(n)` within its length, dates, timestamps, UUIDs, JSON, arrays, `inet`, `bytea`, `interval`
7. nullability: nullable columns become NULL with probability `nullRatio`

CHECK constraints that compare a column to constants (`>`, `>=`, `<`, `<=`, `BETWEEN`, `IN`, `char_length`) are respected. Anything more complex is generated unconstrained and caught by the dry run.

Related timestamps stay consistent: `updated_at` is never before `created_at`, `shipped_at` is not before `placed_at`, and `end` columns follow `start` columns.

## Command-line flags

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--schema <file>` | generate, introspect | DDL file (`-` for stdin) |
| `--url <url>` | all | Database to connect to (default: `DATABASE_URL`) |
| `--db-schema <names>` | all | Database schema or schemas |
| `--rows <n>` | generate, insert | Rows per table |
| `--table-rows a=10,b=500` | generate, insert | Per-table counts |
| `--tables a,b` | generate, insert | Only these tables |
| `--seed <n>` | generate, insert | Root seed |
| `--null-ratio <0..1>` | generate, insert | Chance of NULL |
| `--fk-distribution <uniform or zipf>` | generate, insert | Parent popularity |
| `--format <sql or json or csv>` | generate | Output format. JSON accepts `--ndjson` |
| `--out <path>` | generate | A file (sql, json) or a directory (csv) |
| `--now <date>` | generate, insert | Reference date for relative timestamps |
| `--dry-run` | insert | Validate against the database, then roll back |
| `--truncate` | insert | Empty the selected tables first (see Security) |
| `--confirm-database <name>` | insert | Required for `--truncate` and for production-looking databases |
| `--yes` | insert | Skip the confirmation prompt |
| `--config <file>` | all | A specific config file |

## Output formats

**SQL** is a script wrapped in `BEGIN` and `COMMIT`, with explicit column lists, multi-row `INSERT` statements of 500 rows, `OVERRIDING SYSTEM VALUE` for `GENERATED ALWAYS` identity columns, and a `setval` call after each table that has sequences.

**JSON** is one object, `{ "table": [ rows ] }`, or with `--ndjson` one `{ "table", "row" }` object per line.

**CSV** is one file per table with a header row, in the dialect `COPY ... CSV HEADER` reads: NULL is an empty unquoted field and an empty string is `""`.

When tables reference each other in a cycle, SQL uses `UPDATE` statements after the inserts; JSON and CSV write the final values directly.
