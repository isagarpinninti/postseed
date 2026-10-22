import { create } from "zustand";
import { tableKey } from "../lib/keys";
import type { Format, Plan, Preview, SessionPayload, Settings, Tab } from "./types";

export type Theme = "dark" | "light";

const THEME_KEY = "postseed-theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage can be blocked; the default is fine */
  }
  return "dark";
}

export const DEFAULT_SETTINGS: Settings = { rows: 50, seed: 42, nullRatio: 0.1, format: "sql", fkDistribution: "uniform", tableRows: {} };

export interface InsertState {
  stage: "closed" | "confirm" | "running" | "done" | "failed";
  dryRun: boolean;
  progress: Record<string, { rows: number; total: number }>;
  result?: { totalRows: number; ms: number; tables: Array<{ key: string; rows: number; ms: number }>; database: string; dryRun: boolean };
  error?: { message: string; details?: { table?: string; rowIndex?: number; constraint?: string; detail?: string }; dryRun: boolean };
}

interface Studio {
  theme: Theme;
  setTheme: (t: Theme) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  paletteOpen: boolean;
  setPalette: (v: boolean) => void;

  session: SessionPayload | null;
  setSession: (s: SessionPayload | null) => void;
  serverDown: boolean;
  setServerDown: (v: boolean) => void;

  selected: string[];
  setSelected: (keys: string[]) => void;
  toggleTable: (key: string) => void;
  selectAll: () => void;
  filter: string;
  setFilter: (v: string) => void;

  settings: Settings;
  patchSettings: (p: Partial<Settings>) => void;
  resetSettings: () => void;

  preview: Preview | null;
  setPreview: (p: Preview | null) => void;
  generating: boolean;
  progress: { done: number; total: number } | null;
  setGenerating: (v: boolean, progress?: { done: number; total: number } | null) => void;
  generateError: string | null;
  setGenerateError: (v: string | null) => void;
  plan: Plan | null;
  setPlan: (p: Plan | null) => void;
  showAll: boolean;
  setShowAll: (v: boolean) => void;

  insert: InsertState;
  setInsert: (p: Partial<InsertState>) => void;
  resetInsert: () => void;
}

const closedInsert: InsertState = { stage: "closed", dryRun: false, progress: {} };

export const useStudio = create<Studio>((set, get) => ({
  theme: initialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  tab: "tables",
  setTab: (tab) => set({ tab }),
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),

  session: null,
  setSession: (session) =>
    set({
      session,
      selected: session ? session.db.tables.map(tableKey) : [],
      preview: null,
      plan: null,
      generateError: null,
      showAll: false,
      insert: closedInsert,
    }),
  serverDown: false,
  setServerDown: (serverDown) => set({ serverDown }),

  selected: [],
  setSelected: (selected) => set({ selected }),
  toggleTable: (key) => {
    const cur = get().selected;
    set({ selected: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
  },
  selectAll: () => {
    const s = get().session;
    const all = s ? s.db.tables.map(tableKey) : [];
    set({ selected: get().selected.length === all.length ? [] : all });
  },
  filter: "",
  setFilter: (filter) => set({ filter }),

  settings: DEFAULT_SETTINGS,
  patchSettings: (p) => set({ settings: { ...get().settings, ...p } }),
  resetSettings: () => set({ settings: DEFAULT_SETTINGS, preview: null, showAll: false }),

  preview: null,
  setPreview: (preview) => set({ preview }),
  generating: false,
  progress: null,
  setGenerating: (generating, progress = null) => set({ generating, progress }),
  generateError: null,
  setGenerateError: (generateError) => set({ generateError }),
  plan: null,
  setPlan: (plan) => set({ plan }),
  showAll: false,
  setShowAll: (showAll) => set({ showAll }),

  insert: closedInsert,
  setInsert: (p) => set({ insert: { ...get().insert, ...p } }),
  resetInsert: () => set({ insert: closedInsert }),
}));

/** What a preview is a preview *of*. Insert is allowed only while the current request equals it. */
export function requestOf(selected: string[], s: Settings): Record<string, unknown> {
  return { tables: selected, rows: s.rows, seed: s.seed, nullRatio: s.nullRatio, fkDistribution: s.fkDistribution, tableRows: s.tableRows };
}
export const requestKey = (selected: string[], s: Settings): string => JSON.stringify({ ...requestOf(selected, s), tables: [...selected].sort() });

export const formatLabel: Record<Format, string> = { sql: "SQL", json: "JSON", csv: "CSV" };
