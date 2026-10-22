# Security model

Postseed is a local tool that holds a database password. It is built so that holding that password is as safe as it can be.

## Nothing leaves your machine

There is no telemetry, no analytics and no account. The only network connections Postseed makes are to the PostgreSQL server you point it at. The website Playground runs entirely in your browser; the schema you paste is never uploaded. The test suite checks that no request leaves the machine while Studio and the Playground are used.

## Studio is private to you

- **Local only.** Studio listens on `127.0.0.1`. It does not accept connections from other computers.
- **A one-time token.** Each launch creates a random token. The link printed in your terminal carries it once; Studio swaps it for an HttpOnly cookie and removes it from the address bar. Every API call must present it, so another program on the machine cannot use the API without it.
- **Host and Origin checks.** A request whose Host header is not your own local address is refused, which defeats DNS rebinding. A request from a different website origin is refused, and there are no CORS headers, so no website can read a response.
- **Strict headers.** A content security policy limits Studio to its own scripts and styles.

## Your credentials

- Connection strings are never logged. Anywhere one is shown, the password is replaced with `•••`.
- Saved connections go to `~/.postseed/connections.json` in a directory with mode 0700, in a file with mode 0600. Saving is optional (one checkbox on the connect form). The history file never contains a password.
- `--url` puts the password on the command line, where other users of the same machine can see it in the process list. Prefer the `DATABASE_URL` environment variable.
- If you run your database on another host, use `sslmode=require` in the connection string.

## Writing to a database

- **One transaction.** Everything Postseed inserts is committed together or not at all. If a row fails, nothing is committed and the error names the table, the row and the constraint.
- **Dry run first.** A dry run does the real inserts and rolls back, validating CHECK, unique and foreign-key constraints against your actual database. It leaves sequences alone, since `setval` cannot be rolled back.
- **Insert needs a preview.** In Studio the server will insert only the exact settings you previewed; a changed setting needs a new preview.
- **TRUNCATE is opt-in and deliberate.** It never runs unless you tick the box, name the database by typing it, and see the list of tables `CASCADE` would also empty. In the CLI, `--yes` is not enough; pass `--confirm-database <name>`.
- **Warnings.** Postseed warns loudly when the host is not your own machine or the name looks like production, and then asks for the database name.
- **Escaping.** Identifiers are always quoted when needed, and literals are escaped per type. The tests cover quotes, backslashes, unicode and arrays.

## Least privilege

Seed with a dedicated role, not a superuser:

```sql
CREATE ROLE postseed LOGIN PASSWORD 'change-me';
GRANT USAGE ON SCHEMA public TO postseed;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO postseed;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO postseed;
-- Only for --truncate, and only on a database you can afford to empty:
-- GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO postseed;
-- Tables that form a foreign-key cycle also need UPDATE.
```

## What Postseed does not protect against

A malicious program running as the same operating-system user can read `~/.postseed` and the process list. Treat the account you run Postseed from as trusted. Do not point Postseed at a production database you cannot restore.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on the repository rather than a public issue.
