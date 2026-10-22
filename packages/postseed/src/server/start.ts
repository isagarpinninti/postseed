import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createApp } from "./app";

export interface StudioOptions {
  port?: number;
  host?: string;
  open?: boolean;
  assetsDir?: string;
  /** Fixed token, for tests. The CLI always generates a random one. */
  token?: string;
  version: string;
  onListening?: (info: { url: string; token: string }) => void;
}

export interface RunningStudio {
  url: string;
  token: string;
  port: number;
  close: () => Promise<void>;
}

/** Looks for the built Studio next to the CLI (npm package) or in the workspace. */
export function findAssets(explicit?: string): string | undefined {
  if (explicit) return existsSync(resolve(explicit, "index.html")) ? resolve(explicit) : undefined;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, "../studio-dist"), resolve(here, "../../studio-dist"), resolve(here, "../../../studio/dist")]) {
    if (existsSync(resolve(candidate, "index.html"))) return candidate;
  }
  return undefined;
}

/** Opens the default browser. Best effort: the link is always printed too. */
export function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* no browser available */
  }
}

/** Starts Studio on 127.0.0.1 only, on a random free port unless one is given. */
export async function startStudio(options: StudioOptions): Promise<RunningStudio> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const guardState = { port: 0, token };
  const assetsDir = findAssets(options.assetsDir);
  const app = createApp({ guard: guardState, version: options.version, ...(assetsDir ? { assetsDir } : {}) });
  const host = options.host ?? "127.0.0.1";
  const server = await new Promise<ReturnType<typeof serve>>((resolveListen, reject) => {
    const s = serve({ fetch: app.fetch, port: options.port ?? 0, hostname: host }, () => resolveListen(s));
    s.on("error", reject);
  });
  const port = (server.address() as AddressInfo).port;
  guardState.port = port;
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  options.onListening?.({ url, token });
  if (options.open) openBrowser(url);
  return {
    url,
    token,
    port,
    close: () => new Promise<void>((done) => {
      server.close(() => done());
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    }),
  };
}
