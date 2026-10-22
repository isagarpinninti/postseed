import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { redactUrl } from "./connection";

/** Where Postseed keeps saved connections and history. Override with POSTSEED_HOME. */
export const dataDir = (): string => process.env.POSTSEED_HOME ?? join(homedir(), ".postseed");

export interface SavedConnection {
  id: string;
  name: string;
  /** Includes the password, as typed. The file is created with mode 0600 inside a 0700 directory. */
  url: string;
  schema: string;
  lastUsedAt: string;
}

export type HistoryAction = "insert" | "dry-run" | "download" | "copy";

export interface HistoryEntry {
  id: string;
  at: string;
  connectionName: string;
  /** Redacted; never contains a password. */
  connection: string;
  tables: string[];
  rows: number;
  seed: number;
  format: "sql" | "json" | "csv";
  action: HistoryAction;
  settings: { rowsPerTable: number; nullRatio: number; tableRows?: Record<string, number> };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    return fallback;
  }
}

async function writePrivate(file: string, data: unknown): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600).catch(() => undefined);
}

const connectionsFile = (): string => join(dataDir(), "connections.json");
const historyFile = (): string => join(dataDir(), "history.json");

export const listConnections = async (): Promise<SavedConnection[]> =>
  (await readJson<SavedConnection[]>(connectionsFile(), [])).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

export async function saveConnection(input: { name: string; url: string; schema?: string }): Promise<SavedConnection> {
  const all = await readJson<SavedConnection[]>(connectionsFile(), []);
  const existing = all.find((c) => c.url === input.url);
  const entry: SavedConnection = {
    id: existing?.id ?? randomUUID(),
    name: input.name || existing?.name || "Untitled",
    url: input.url,
    schema: input.schema ?? "public",
    lastUsedAt: new Date().toISOString(),
  };
  await writePrivate(connectionsFile(), [...all.filter((c) => c.id !== entry.id), entry]);
  return entry;
}

export async function touchConnection(id: string): Promise<void> {
  const all = await readJson<SavedConnection[]>(connectionsFile(), []);
  const found = all.find((c) => c.id === id);
  if (found) {
    found.lastUsedAt = new Date().toISOString();
    await writePrivate(connectionsFile(), all);
  }
}

export async function deleteConnection(id: string): Promise<void> {
  const all = await readJson<SavedConnection[]>(connectionsFile(), []);
  await writePrivate(connectionsFile(), all.filter((c) => c.id !== id));
}

export const getConnection = async (id: string): Promise<SavedConnection | undefined> =>
  (await readJson<SavedConnection[]>(connectionsFile(), [])).find((c) => c.id === id);

export const listHistory = async (): Promise<HistoryEntry[]> =>
  (await readJson<HistoryEntry[]>(historyFile(), [])).sort((a, b) => b.at.localeCompare(a.at));

export async function addHistory(entry: Omit<HistoryEntry, "id" | "at" | "connection"> & { connectionUrl: string }): Promise<HistoryEntry> {
  const { connectionUrl, ...rest } = entry;
  const full: HistoryEntry = { ...rest, id: randomUUID(), at: new Date().toISOString(), connection: redactUrl(connectionUrl) };
  const all = await readJson<HistoryEntry[]>(historyFile(), []);
  await writePrivate(historyFile(), [full, ...all].slice(0, 500));
  return full;
}
