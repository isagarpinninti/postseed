import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { HAS_PG, startPostgres } from "../../pg/test/pgserver";
import { startStudio } from "../src/server/start";

export const PORT = 4377;
export const TOKEN = "e2e-token";

/** Starts a throwaway Postgres loaded with the example schema, then Studio in front of it. */
export default async function setup(): Promise<() => Promise<void>> {
  if (!HAS_PG) throw new Error("e2e needs Postgres: install it, or set POSTSEED_TEST_DATABASE_URL.");
  process.env.POSTSEED_HOME = mkdtempSync(join(tmpdir(), "postseed-e2e-home-"));
  const server = await startPostgres();
  const url = await server.createDatabase("e2e");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(readFileSync(new URL("../../../examples/fulfillment.sql", import.meta.url), "utf8"));
  await client.end();
  process.env.E2E_DATABASE_URL = url;
  const studio = await startStudio({ port: PORT, token: TOKEN, version: "0.1.0", open: false });
  return async () => {
    await studio.close();
    await server.stop();
  };
}
