# FAQ

## Does my data or schema leave my machine?

No. Studio and the CLI only talk to the PostgreSQL server you give them. The Playground on the website runs in your browser; your schema is never uploaded. There is no telemetry.

## Is this safe to run against a real database?

It is designed to be: one transaction, a dry run that validates against the real database, and a refusal to truncate unless you type the database's name. Even so, use a development or staging database, and a role with only the privileges it needs. See the [security model](SECURITY_MODEL.md).

## Why is the output identical every time?

Because it should be. The same schema, seed and version give byte-identical data, which lets CI regenerate fixtures and lets you share a bug as "seed 8123". See [determinism](DETERMINISM.md).

## Which databases are supported?

PostgreSQL only. Versions 15 to 18 are in the automated test matrix.

## Can it anonymize my production data?

No. Postseed creates new, fictional data from your schema. It does not read or transform real rows (apart from reading keys so new rows can reference existing parents).

## How does it keep foreign keys valid?

It orders tables parents-first and gives each child row a key taken from a real parent row. Cycles are handled by inserting NULL and filling in the key afterwards, or by deferring constraints if the key is deferrable. If neither is possible, it tells you which tables are the problem.

## What if a table references one I did not select?

Studio shows a banner. If that table already has rows in the database, new rows point at those. If it is empty, add it to the selection.

## Why did a unique column get a suffix like `-17`?

When a column has far fewer possible values than rows (a unique email at 100,000 rows, say), Postseed first retries, then appends the row number so every value is still unique and the run still succeeds.

## Does it support every Postgres type?

It supports integers, numeric, floats, text types, booleans, dates and times, intervals, UUID, JSON and JSONB, `inet` and `cidr`, `macaddr`, `bytea`, bit strings, XML, enums, domains and arrays. Geometric types, ranges and full-text types are not generated; such a column is left to its default (or NULL), and you can fill one with an override.

## How do I get a specific value in a column?

Use an override in `postseed.config.ts`. See the [configuration reference](CONFIG.md).

## Is it free?

Yes. Postseed is open source under the MIT license.
