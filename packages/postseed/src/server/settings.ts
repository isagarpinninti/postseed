import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { GenerateOptions } from "@postseed/core";

export type Format = "sql" | "json" | "csv";

export interface Settings {
  tables: string[];
  rows: number;
  tableRows: Record<string, number>;
  seed: number;
  nullRatio: number;
  fkDistribution: "uniform" | "zipf";
  format: Format;
}

export class BadRequest extends Error {
  constructor(
    message: string,
    readonly code = "BAD_REQUEST",
    readonly status: 400 | 403 | 404 | 409 | 422 = 400,
  ) {
    super(message);
  }
}

const num = (v: unknown, name: string, min: number, max: number, fallback: number, integer = true): number => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new BadRequest(`"${name}" must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`);
  }
  return v;
};

export const MAX_ROWS = 1_000_000;

/** Validates the settings object sent by Studio. Nothing from the body is trusted. */
export function parseSettings(body: unknown): Settings {
  if (typeof body !== "object" || body === null) throw new BadRequest("Expected a JSON object.");
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.tables) || !b.tables.every((t) => typeof t === "string")) throw new BadRequest('"tables" must be a list of table names.');
  if (b.tables.length === 0) throw new BadRequest("Select at least one table.");
  const format = (b.format ?? "sql") as string;
  if (format !== "sql" && format !== "json" && format !== "csv") throw new BadRequest('"format" must be sql, json or csv.');
  const fk = (b.fkDistribution ?? "uniform") as string;
  if (fk !== "uniform" && fk !== "zipf") throw new BadRequest('"fkDistribution" must be uniform or zipf.');
  const tableRows: Record<string, number> = {};
  if (b.tableRows !== undefined) {
    if (typeof b.tableRows !== "object" || b.tableRows === null) throw new BadRequest('"tableRows" must be an object.');
    for (const [k, v] of Object.entries(b.tableRows)) tableRows[k] = num(v, `tableRows.${k}`, 0, MAX_ROWS, 0);
  }
  return {
    tables: b.tables as string[],
    rows: num(b.rows, "rows", 0, MAX_ROWS, 50),
    tableRows,
    seed: num(b.seed, "seed", -2_147_483_648, 4_294_967_295, 42),
    nullRatio: num(b.nullRatio, "nullRatio", 0, 1, 0.1, false),
    fkDistribution: fk,
    format,
  };
}

export function toOptions(s: Settings, extra: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    seed: s.seed,
    rows: s.rows,
    ...(Object.keys(s.tableRows).length > 0 ? { tableRows: s.tableRows } : {}),
    tables: s.tables,
    nullRatio: s.nullRatio,
    fkDistribution: s.fkDistribution,
    ...extra,
  };
}

/** Insert requires a token issued with a preview of exactly these settings, so nothing unseen is ever written. */
export class ConfirmTokens {
  private readonly secret = randomBytes(32);

  private mac(settings: Settings, binding: string, exp: number): string {
    const { format: _format, ...core } = settings;
    void _format;
    const payload = JSON.stringify({ core: { ...core, tables: [...core.tables].sort() }, binding, exp });
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  issue(settings: Settings, binding: string, ttlMs = 30 * 60_000): string {
    const exp = Date.now() + ttlMs;
    return `${exp}.${this.mac(settings, binding, exp)}`;
  }

  verify(token: unknown, settings: Settings, binding: string): boolean {
    if (typeof token !== "string") return false;
    const [expText, mac] = token.split(".");
    const exp = Number(expText);
    if (!mac || !Number.isFinite(exp) || exp < Date.now()) return false;
    const want = Buffer.from(this.mac(settings, binding, exp));
    const got = Buffer.from(mac);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
