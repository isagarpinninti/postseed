import { startStudio } from "../server/start";
import { style, type Io } from "../io";
import { parseFlags, UsageError } from "../shared";
import { VERSION } from "../version";

export const STUDIO_HELP = `postseed: start Studio, the local web app

  npx postseed [--port 4310] [--no-open]

Studio listens on 127.0.0.1 only, on a random free port unless --port is given, and the link carries a
one-time token. Nothing leaves your machine except connections to your own Postgres.
`;

export async function runStudio(argv: string[], io: Io): Promise<number> {
  const { values } = parseFlags(argv, { port: { type: "string" }, "no-open": { type: "boolean" } });
  if (values.help) {
    io.out(STUDIO_HELP);
    return 0;
  }
  let port: number | undefined;
  if (typeof values.port === "string") {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be between 0 and 65535.");
  }
  const s = style(io);
  const studio = await startStudio({
    ...(port !== undefined ? { port } : {}),
    open: values["no-open"] !== true && io.interactive,
    version: VERSION,
    onListening: ({ url }) => {
      io.err(`${s.bold("Postseed Studio")} is running\n  ${s.cyan(url)}\n  ${s.dim("Local only (127.0.0.1). Press Ctrl+C to stop.")}\n`);
    },
  });
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void studio.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
