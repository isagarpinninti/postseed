# Determinism guarantees

**The same schema, seed, options and Postseed version always produce byte-identical output.** That holds across machines, operating systems, Node versions and days. It is checked by snapshot tests and by property tests over random schemas.

## How it works

- A seeded random generator (a string hash feeding a 128-bit generator) is the only source of randomness. Nothing reads the clock, the network or your environment.
- Every column has its own stream, derived from the root seed, the table name and the column name. A separate stream decides which values become NULL.
- Text comes from Faker, which is pinned to one exact version. Each column gets its own Faker instance seeded from its stream.
- "Within the last two years" is measured from a fixed reference date, not from today. Pass `--now 2027-01-01` to move it.

## What does not change your data

- Adding or removing another table, or another column.
- Changing `nullRatio` (it only decides which values become NULL; the values themselves stay the same).
- The machine, the time, the Node version.

## What does change it

- The column's own definition: its type, length, constraints, name or table.
- The number of rows in a parent table, because children pick from that many parents. The first rows of a table are the same whether you ask for 100 or 10,000; their foreign keys are not.
- Overrides, `fkDistribution`, `--now`.
- **Appending to a database that already has rows.** Existing ids and unique values are read from the database, so output depends on what is there. For fixtures that must be identical everywhere, generate from a schema file, or start from an empty database.
- **A new Postseed or Faker version.** Output improvements are a deliberate change, listed in the changelog. Pin the exact version when you commit expectations that depend on the data.

## Why this matters

Reproducible seeds make bug reports trivial ("seed 8123 breaks the export"), let CI regenerate fixtures instead of storing large files, and let two people see the same data.
