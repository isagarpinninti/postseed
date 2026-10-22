import { api, downloadFile, stream, ApiError } from "./api";
import { requestKey, requestOf, useStudio } from "./store";
import type { Plan, Preview, SessionPayload } from "./types";

/** Studio actions that talk to the local server. Kept out of components so the palette and buttons share them. */

export async function connect(body: { url?: string; connectionId?: string; schema?: string; save?: boolean; name?: string }): Promise<SessionPayload> {
  const session = await api<SessionPayload>("/api/connect", body);
  useStudio.getState().setSession(session);
  return session;
}

export async function disconnect(): Promise<void> {
  await api("/api/disconnect", {}).catch(() => undefined);
  useStudio.getState().setSession(null);
}

export async function refreshPlan(): Promise<Plan | null> {
  const { selected, settings, setPlan } = useStudio.getState();
  if (selected.length === 0) {
    setPlan(null);
    return null;
  }
  try {
    const plan = await api<Plan>("/api/plan", { ...requestOf(selected, settings), format: settings.format });
    // Ignore an answer to a request that is no longer the current one.
    if (requestKey(useStudio.getState().selected, useStudio.getState().settings) === requestKey(selected, settings)) setPlan(plan);
    return plan;
  } catch {
    setPlan(null);
    return null;
  }
}

export async function generate(opts: { all?: boolean } = {}): Promise<void> {
  const st = useStudio.getState();
  if (st.selected.length === 0 || st.generating) return;
  const key = requestKey(st.selected, st.settings);
  st.setGenerating(true, { done: 0, total: st.selected.length });
  st.setGenerateError(null);
  let result: Omit<Preview, "key"> | undefined;
  let failure: string | undefined;
  try {
    await stream("/api/generate?stream=1", { ...requestOf(st.selected, st.settings), format: st.settings.format, previewRows: opts.all ? "all" : 200 }, (m) => {
      if (m.event === "progress") {
        const p = m.data as { done: number; total: number };
        useStudio.getState().setGenerating(true, { done: p.done, total: p.total });
      } else if (m.event === "result") result = m.data as Omit<Preview, "key">;
      else if (m.event === "error") failure = (m.data as { message: string }).message;
    });
  } catch (e) {
    failure = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
  }
  const s = useStudio.getState();
  s.setGenerating(false, null);
  if (failure) s.setGenerateError(failure);
  else if (result) {
    s.setPreview({ ...result, key });
    s.setShowAll(opts.all === true);
  }
}

export async function download(): Promise<void> {
  const { selected, settings } = useStudio.getState();
  await downloadFile("/api/download", { ...requestOf(selected, settings), format: settings.format });
}

export async function logCopy(): Promise<void> {
  const { selected, settings } = useStudio.getState();
  await api("/api/history", { settings: { ...requestOf(selected, settings), format: settings.format }, action: "copy" }).catch(() => undefined);
}

export async function runInsert(opts: { dryRun: boolean; truncate: boolean; confirmDatabase?: string }): Promise<void> {
  const st = useStudio.getState();
  const preview = st.preview;
  if (!preview) return;
  st.setInsert({ stage: "running", dryRun: opts.dryRun, progress: {}, result: undefined, error: undefined });
  try {
    await stream(
      "/api/insert",
      {
        settings: { ...requestOf(st.selected, st.settings), format: "sql" },
        confirmToken: preview.confirmToken,
        dryRun: opts.dryRun,
        truncate: opts.truncate,
        ...(opts.confirmDatabase !== undefined ? { confirmDatabase: opts.confirmDatabase } : {}),
      },
      (m) => {
        const s = useStudio.getState();
        if (m.event === "progress") {
          const p = m.data as { table: string; rows: number; total: number };
          s.setInsert({ progress: { ...s.insert.progress, [p.table]: { rows: p.rows, total: p.total } } });
        } else if (m.event === "done") s.setInsert({ stage: "done", result: m.data as never });
        else if (m.event === "error") {
          const e = m.data as { message: string; details?: Record<string, never>; dryRun: boolean };
          s.setInsert({ stage: "failed", error: { message: e.message, details: e.details as never, dryRun: opts.dryRun } });
        }
      },
    );
  } catch (e) {
    useStudio.getState().setInsert({ stage: "failed", error: { message: e instanceof Error ? e.message : String(e), dryRun: opts.dryRun } });
  }
}
