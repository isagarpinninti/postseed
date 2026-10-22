import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

/**
 * A throwaway Postgres for integration tests. In CI, point POSTSEED_TEST_DATABASE_URL at a service
 * container; locally a temporary cluster is started with initdb if one is installed. Tests that need a
 * server are skipped when neither exists.
 */
const CANDIDATES = [
  process.env.POSTSEED_PG_BIN ?? "",
  ...["18", "17", "16", "15", "14"].flatMap((v) => [`/opt/homebrew/opt/postgresql@${v}/bin`, `/usr/lib/postgresql/${v}/bin`, `/usr/local/opt/postgresql@${v}/bin`]),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];
export const PG_BIN = CANDIDATES.find((d) => d && existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
export const EXTERNAL_URL = process.env.POSTSEED_TEST_DATABASE_URL;
export const HAS_PG = !!PG_BIN || !!EXTERNAL_URL;

const LOCALE = process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
const ENV = { ...process.env, LC_ALL: LOCALE, LANG: LOCALE };

export interface TestServer {
  /** Admin URL (database `postgres`). */
  url: string;
  stop: () => Promise<void>;
  /** Creates a fresh, empty database and returns its URL. */
  createDatabase: (name: string) => Promise<string>;
}

export async function startPostgres(): Promise<TestServer> {
  let url = EXTERNAL_URL ?? "";
  let dir = "";
  if (!EXTERNAL_URL) {
    if (!PG_BIN) throw new Error("no Postgres available");
    dir = mkdtempSync(join(tmpdir(), "postseed-pg-"));
    const port = 30000 + Math.floor(Math.random() * 20000);
    execFileSync(join(PG_BIN, "initdb"), ["-D", join(dir, "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore", env: ENV });
    execFileSync(
      join(PG_BIN, "pg_ctl"),
      ["-D", join(dir, "data"), "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=60`, "-l", join(dir, "log"), "-w", "start"],
      { stdio: "ignore", env: ENV },
    );
    url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  }
  const withDb = (name: string): string => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return u.toString();
  };
  return {
    url,
    async createDatabase(name) {
      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
        await admin.query(`CREATE DATABASE "${name}"`);
      } finally {
        await admin.end();
      }
      return withDb(name);
    },
    async stop() {
      if (!EXTERNAL_URL && PG_BIN && dir) {
        execFileSync(join(PG_BIN, "pg_ctl"), ["-D", join(dir, "data"), "-m", "fast", "-w", "stop"], { stdio: "ignore", env: ENV });
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
