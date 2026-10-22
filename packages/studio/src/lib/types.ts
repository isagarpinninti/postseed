import type { Database } from "@postseed/core";

export type Format = "sql" | "json" | "csv";
export type Tab = "tables" | "templates" | "history" | "docs";

export interface ConnectionSummary {
  id: string | null;
  name: string;
  database: string;
  user: string;
  host: string;
  serverVersion: string;
  redactedUrl: string;
  schema: string;
  isLocal: boolean;
  looksProduction: boolean;
}

export interface SessionPayload {
  connection: ConnectionSummary;
  db: Database;
  estimates: Record<string, number>;
}

export interface SavedConnection {
  id: string;
  name: string;
  redactedUrl: string;
  schema: string;
  lastUsedAt: string;
}

export interface Settings {
  rows: number;
  seed: number;
  nullRatio: number;
  format: Format;
  fkDistribution: "uniform" | "zipf";
  tableRows: Record<string, number>;
}

export interface Stats {
  tables: number;
  rows: number;
  rowsByTable: Record<string, number>;
  estimatedBytes: number;
  ms: number;
  seed: number;
  previewRows: number;
  truncated: boolean;
}

export interface Preview {
  text: string;
  format: Format;
  stats: Stats;
  order: string[];
  warnings: string[];
  confirmToken: string;
  /** The exact request this preview answers; insert is only allowed for it. */
  key: string;
}

export interface Plan {
  order: string[];
  rows: Record<string, number>;
  totalRows: number;
  warnings: string[];
  errors: Array<{ code: string; message: string }>;
  missingParents: Array<{ table: string; parent: string; columns: string[]; existing: number; capped: boolean }>;
  truncateImpact: string[];
}

export interface HistoryEntry {
  id: string;
  at: string;
  connectionName: string;
  connection: string;
  tables: string[];
  rows: number;
  seed: number;
  format: Format;
  action: "insert" | "dry-run" | "download" | "copy";
  settings: { rowsPerTable: number; nullRatio: number; tableRows?: Record<string, number> };
}
