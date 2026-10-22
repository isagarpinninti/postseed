import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ColumnOverride } from "@postseed/core";
import { createJiti } from "jiti";

export interface PostseedConfig {
  /** Rows generated per table (default 50). */
  rows?: number;
  /** Per-table row counts, by `table` or `schema.table`. */
  tableRows?: Record<string, number>;
  /** Probability that a nullable column is NULL (default 0.1). */
  nullRatio?: number;
  seed?: number;
  /** Only `en` ships in v1. */
  locale?: "en";
  /** Replace how a column is generated, keyed `table.column`. */
  overrides?: Record<string, ColumnOverride>;
  /** Restrict generation to these tables. */
  tables?: string[];
  /** Database schema to read when connecting (default `public`). */
  dbSchema?: string;
  fkDistribution?: "uniform" | "zipf";
}

/** Identity helper that gives `postseed.config.ts` full type checking. */
export function defineConfig(config: PostseedConfig): PostseedConfig {
  return config;
}

const NAMES = ["postseed.config.ts", "postseed.config.mts", "postseed.config.js", "postseed.config.mjs", "postseed.config.cjs", "postseed.config.json"];
const KEYS = new Set(["rows", "tableRows", "nullRatio", "seed", "locale", "overrides", "tables", "dbSchema", "fkDistribution"]);

export class ConfigError extends Error {}

export function findConfig(cwd: string): string | undefined {
  return NAMES.map((n) => resolve(cwd, n)).find((p) => existsSync(p));
}

function validate(raw: unknown, file: string): PostseedConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError(`${file}: the config must export an object (use defineConfig({ ... })).`);
  const c = raw as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!KEYS.has(k)) throw new ConfigError(`${file}: unknown option "${k}". Known options: ${[...KEYS].join(", ")}.`);
  const num = (k: string, min: number, max: number): void => {
    if (c[k] !== undefined && (typeof c[k] !== "number" || !Number.isFinite(c[k]) || (c[k] as number) < min || (c[k] as number) > max)) {
      throw new ConfigError(`${file}: "${k}" must be a number between ${min} and ${max}.`);
    }
  };
  num("rows", 0, 10_000_000);
  num("nullRatio", 0, 1);
  num("seed", -2_147_483_648, 4_294_967_295);
  if (c.locale !== undefined && c.locale !== "en") throw new ConfigError(`${file}: only locale "en" is supported in this version.`);
  if (c.fkDistribution !== undefined && c.fkDistribution !== "uniform" && c.fkDistribution !== "zipf") throw new ConfigError(`${file}: "fkDistribution" must be "uniform" or "zipf".`);
  if (c.overrides !== undefined && (typeof c.overrides !== "object" || c.overrides === null)) throw new ConfigError(`${file}: "overrides" must be an object keyed "table.column".`);
  return c as PostseedConfig;
}

export async function loadConfig(cwd: string, explicit?: string): Promise<{ config: PostseedConfig; file?: string }> {
  const file = explicit ? resolve(cwd, explicit) : findConfig(cwd);
  if (!file) return { config: {} };
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  try {
    const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
    const mod = (await jiti.import(file, { default: true })) as unknown;
    return { config: validate(mod, file), file };
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`Could not load ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const CONFIG_TEMPLATE = `import { defineConfig } from "postseed";

export default defineConfig({
  // Rows per table. Override one table with tableRows: { orders: 500 }.
  rows: 50,
  // Probability that a nullable column is NULL.
  nullRatio: 0.1,
  locale: "en",
  // Replace how a column is generated, keyed "table.column":
  overrides: {
    // "users.email": { template: "user{n}@example.com" },
    // "orders.status": { pick: ["paid", "shipped"], weights: [3, 1] },
    // "products.price": { float: [5, 500], decimals: 2 },
    // "customers.phone": { faker: "phone.number" },
  },
});
`;
