import { PostseedError } from "@postseed/core";
import { ConnectionError, InsertError, redactText } from "@postseed/pg";
import { ConfigError } from "./config";
import { runGenerate, GENERATE_HELP } from "./commands/generate";
import { runInit, INIT_HELP } from "./commands/init";
import { runInsert, INSERT_HELP } from "./commands/insert";
import { runIntrospect, INTROSPECT_HELP } from "./commands/introspect";
import { STUDIO_HELP } from "./commands/studio";
import { style, type Io } from "./io";
import { UsageError } from "./shared";

import { VERSION } from "./version";
export { VERSION };

export const HELP = `postseed ${VERSION}: realistic Postgres seed data. In seconds.

Usage
  postseed                       start Studio on 127.0.0.1 and open the browser
  postseed generate              write seed data (SQL, JSON or CSV) for a schema or database
  postseed insert                insert seed data into a database in one transaction
  postseed introspect            show the tables, keys and enums Postseed sees
  postseed init                  write a starter postseed.config.ts

Run "postseed <command> --help" for options.
Exit codes: 0 ok · 1 error · 2 usage · 3 dry run found a violation
`;

const HELPS: Record<string, string> = { studio: STUDIO_HELP, generate: GENERATE_HELP, insert: INSERT_HELP, introspect: INTROSPECT_HELP, init: INIT_HELP };

export type StudioRunner = (argv: string[], io: Io) => Promise<number>;

/** Parses argv and runs a command. Returns the process exit code; never throws for expected failures. */
export async function run(argv: string[], io: Io, studio?: StudioRunner): Promise<number> {
  const s = style(io);
  const [command, ...rest] = argv;
  try {
    if (command === "--version" || command === "-v" || command === "version") {
      io.out(`${VERSION}\n`);
      return 0;
    }
    if (command === "help" || command === "--help" || command === "-h") {
      const topic = rest[0];
      io.out(topic && HELPS[topic] ? HELPS[topic] : HELP);
      return 0;
    }
    if (!command || command.startsWith("-") || command === "studio") {
      const args = command === "studio" ? rest : argv;
      if (!studio) throw new UsageError("Studio is not available in this build.");
      return await studio(args, io);
    }
    switch (command) {
      case "generate":
        return await runGenerate(rest, io);
      case "insert":
        return await runInsert(rest, io);
      case "introspect":
        return await runIntrospect(rest, io);
      case "init":
        return await runInit(rest, io);
      default:
        throw new UsageError(`Unknown command "${command}". Run "postseed --help".`);
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError) {
      io.err(`${s.red("✖")} ${redactText(e.message)}\n`);
      return 2;
    }
    if (e instanceof ConnectionError) {
      io.err(`${s.red("✖")} ${e.message}\n  ${s.dim(e.hint)}\n`);
      return 1;
    }
    if (e instanceof PostseedError || e instanceof InsertError) {
      io.err(`${s.red("✖")} ${redactText(e.message)}\n`);
      return 1;
    }
    io.err(`${s.red("✖")} ${redactText(e instanceof Error ? e.message : String(e))}\n`);
    return 1;
  }
}
