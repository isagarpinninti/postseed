import pg from "pg";

/** Replaces the password in any `postgres://user:password@host` it finds. */
export function redactText(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:\s/@]*):([^@\s]*)@/gi, "$1:•••@");
}

export function redactUrl(url: string): string {
  return redactText(url);
}

export type ConnectionErrorCode = "AUTH" | "SSL" | "DNS" | "TIMEOUT" | "REFUSED" | "NO_DATABASE" | "BAD_URL" | "UNKNOWN";

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly code: ConnectionErrorCode,
    readonly hint: string,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Turns a driver error into one a person can act on. Never includes the connection string. */
export function friendlyConnectionError(err: unknown): ConnectionError {
  const e = (err ?? {}) as PgLikeError;
  const raw = redactText(e.message ?? String(err));
  const code = e.code ?? "";
  if (code === "28P01" || code === "28000" || /password authentication failed/i.test(raw)) {
    if (/no pg_hba\.conf entry/i.test(raw)) {
      return new ConnectionError("The server rejected this connection (no matching pg_hba.conf rule).", "SSL", "Check that your IP is allowed and whether the server needs SSL: add ?sslmode=require to the connection string.");
    }
    return new ConnectionError("Authentication failed: the user or password is wrong.", "AUTH", "Check the username and password in the connection string, and that the role may log in.");
  }
  if (code === "3D000" || /database ".*" does not exist/i.test(raw)) {
    return new ConnectionError("That database does not exist on the server.", "NO_DATABASE", "Check the database name at the end of the connection string.");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new ConnectionError("The host name could not be found.", "DNS", "Check the host in the connection string and your network or VPN.");
  }
  if (code === "ECONNREFUSED") {
    return new ConnectionError("The server refused the connection.", "REFUSED", "Check that Postgres is running and that the host and port are right.");
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(raw)) {
    return new ConnectionError("The connection timed out.", "TIMEOUT", "Check the host and port, a firewall, or that the server accepts connections from your IP.");
  }
  if (/ssl/i.test(raw) || /self[- ]signed|certificate/i.test(raw) || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return new ConnectionError("The SSL handshake failed.", "SSL", "Use ?sslmode=require (or sslmode=disable for a local server that has no SSL).");
  }
  if (/invalid (connection )?(url|string)|ERR_INVALID_URL/i.test(raw)) {
    return new ConnectionError("The connection string is not valid.", "BAD_URL", "Use postgres://user:password@host:5432/database.");
  }
  return new ConnectionError(raw.split("\n")[0] ?? "Could not connect.", "UNKNOWN", "Check the connection string.");
}

/** Every value comes back as text; the introspection and insert code converts what it needs. */
const textTypes = { getTypeParser: () => (value: string) => value } as unknown as pg.ClientConfig["types"];

export interface ConnectOptions {
  /** Milliseconds to wait for the connection (default 8000). */
  timeout?: number;
  applicationName?: string;
}

export async function connect(url: string, options: ConnectOptions = {}): Promise<pg.Client> {
  if (!/^postgres(ql)?:\/\//i.test(url.trim())) {
    throw new ConnectionError("The connection string is not valid.", "BAD_URL", "Use postgres://user:password@host:5432/database.");
  }
  const client = new pg.Client({
    connectionString: url.trim(),
    connectionTimeoutMillis: options.timeout ?? 8000,
    application_name: options.applicationName ?? "postseed",
    types: textTypes,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (e) {
    await client.end().catch(() => undefined);
    throw friendlyConnectionError(e);
  }
  return client;
}

export interface ConnectionInfo {
  database: string;
  user: string;
  serverVersion: string;
  host: string;
}

export async function describeConnection(client: pg.Client, url: string): Promise<ConnectionInfo> {
  const r = await client.query<{ database: string; user: string; version: string }>(
    "SELECT current_database() AS database, current_user AS user, current_setting('server_version') AS version",
  );
  const row = r.rows[0] as { database: string; user: string; version: string };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  return { database: row.database, user: row.user, serverVersion: row.version, host };
}

export async function testConnection(url: string): Promise<ConnectionInfo> {
  const client = await connect(url);
  try {
    return await describeConnection(client, url);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/** True when the host is this machine (or a unix socket). Used to warn before writing to a remote database. */
export function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return LOCAL.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** Names that suggest a production database. */
export function looksLikeProduction(url: string, database: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  return /(^|[-_.])(prod|production|live|primary|master)([-_.]|$)/i.test(`${host} ${database}`);
}
