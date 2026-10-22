# Contributing

Thank you for helping. Postseed is small enough to hold in your head, and it aims to stay that way.

## Setup

You need Node.js 20 or newer and [pnpm](https://pnpm.io) (`corepack enable` is enough).

```bash
git clone https://github.com/isagarpinninti/postseed
cd postseed
pnpm install
pnpm build
```

## The loop

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e     # = pnpm gates
```

| Command | Purpose |
| --- | --- |
| `pnpm test` | Unit, property, corpus, integration and server tests (Vitest) |
| `pnpm e2e` | Studio in a real browser, against a real PostgreSQL (Playwright) |
| `pnpm --filter @postseed/web exec playwright test` | The website in a real browser |
| `pnpm bench` | The performance budget |
| `pnpm smoke` | Pack the packages, install them in an empty folder, run the real CLI and Studio |
| `pnpm bundle:launchers` | Build the engine bundle used by the Python and Ruby packages |

Playwright needs its browser once: `pnpm exec playwright install chromium` in `packages/postseed`.

### PostgreSQL for tests

Tests that need a database start a throwaway cluster with `initdb` if PostgreSQL is installed (Homebrew, apt and the official images all work). Otherwise set `POSTSEED_TEST_DATABASE_URL` to an empty server you can create databases on; CI does this with service containers for PostgreSQL 15 to 18. Without either, those tests are skipped and say so.

## Ground rules

- **Determinism is a feature.** If you change what a seed produces, say so in your pull request and add a changeset. Snapshot tests exist to make this loud.
- **Never an orphan, a duplicate or a NULL in a NOT NULL column.** Add a test that would have caught a bug before you fix it; the random-schema property test and the corpus are good places.
- **Strict TypeScript, no `any`.** ESLint enforces it.
- **No network calls** other than to the user's own PostgreSQL, and no telemetry. A test checks this for Studio and the website.
- **The `core` package stays free of Node APIs** so it keeps running in the browser.
- **Docs live in `docs/`.** The website builds its pages from them; relative links are checked by `pnpm test`.
- Use plain language. Say what a limit is instead of hiding it.

## Pull requests

1. Open an issue first for anything large.
2. Keep the change focused and add tests.
3. Run `pnpm gates`.
4. Add a changeset (`pnpm changeset`) for anything users can see.

## Releasing (maintainers)

Releases use [Changesets](https://github.com/changesets/changesets) and npm provenance.

1. `pnpm changeset version` and merge the result.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`. The release workflow runs every gate and publishes `@postseed/core`, `@postseed/pg` and `postseed` to npm.
3. The Python and Ruby packages have their own tags: `python-v0.1.0` and `ruby-v0.1.0` (the tag must match the version in `pyproject.toml` / the gemspec).

Secrets used by the workflows: `NPM_TOKEN` (an npm automation or granular token that bypasses 2FA), `PYPI_API_TOKEN` and `RUBYGEMS_API_KEY`.
