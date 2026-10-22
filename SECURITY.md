# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for something exploitable.

Include what you found, how to reproduce it, and the version of Postseed. You will get an acknowledgement within a few days. Fixes ship as a patch release and are credited if you wish.

## What counts

Postseed holds a database password and writes to a database, so the most serious reports are about:

- Studio being reachable or usable from another machine, website or local program without the token
- a connection string or password appearing in a log, an error, a file or the network
- a way to make Postseed write to or truncate a database without the confirmation it is supposed to need
- SQL or shell injection through a schema, a config file or a command-line value
- reading or writing files outside the places Postseed documents

## How it is designed

See the [security model](docs/SECURITY_MODEL.md): local-only binding, a per-launch token with Host and Origin checks, no telemetry, redacted credentials, one transaction, dry run, and a deliberate `TRUNCATE`.

## Supported versions

The latest release receives fixes.
