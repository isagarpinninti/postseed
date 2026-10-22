import { Check, ChevronRight, Copy, Download, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { logCopy, download, generate, refreshPlan } from "../lib/actions";
import { bytes, fmt } from "../lib/scale";
import { requestKey, requestOf, useStudio } from "../lib/store";
import { Banner, Button, Skeleton, Spinner } from "../shared/ui";
import { OutputPane } from "../shared/OutputPane";
import { InsertDialog } from "./InsertDialog";
import { StudioSettings } from "./SettingsStrip";
import { SuccessPanel } from "./SuccessPanel";
import { TableSidebar } from "./TableSidebar";

export function StudioScreen(): ReactNode {
  const st = useStudio();
  const { session, selected, settings, preview, generating, progress, generateError, plan, insert } = st;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = requestKey(selected, settings);
  // Plan the selection whenever it changes (cheap: no rows are generated).
  useEffect(() => {
    const t = setTimeout(() => void refreshPlan(), 160);
    return () => clearTimeout(t);
  }, [key]);

  const stale = preview !== null && preview.key !== key;
  const totalRows = plan?.totalRows ?? preview?.stats.rows ?? 0;
  const blocked = (plan?.errors.length ?? 0) > 0 || (plan?.missingParents ?? []).some((m) => m.existing === 0 && !isNullableFk(session?.db, m.table, m.columns));
  const canInsert = preview !== null && !stale && !generating && !blocked && selected.length > 0;

  const missing = useMemo(() => plan?.missingParents ?? [], [plan]);

  if (insert.stage === "done" || insert.stage === "failed") return <ResultView />;

  return (
    <div className="flex min-h-0 flex-1">
      <TableSidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Generate seed</h1>
            <p className="mt-0.5 text-[13px] text-muted">
              {selected.length} table{selected.length === 1 ? "" : "s"} selected · ordered by FK dependency
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => { st.resetSettings(); st.setPreview(null); }}>
              Reset
            </Button>
            <Button variant="primary" icon={generating ? undefined : <Sparkles className="size-4" aria-hidden />} loading={generating} disabled={selected.length === 0 || blocked} onClick={() => void generate()}>
              {generating ? (progress ? `Generating ${progress.done}/${progress.total}` : "Generating") : "Generate"}
            </Button>
          </div>
        </div>

        {missing.map((m) => (
          <Banner
            key={`${m.table}>${m.parent}`}
            tone={m.existing === 0 ? "warn" : "info"}
            title={
              <span>
                <code className="font-mono">{short(m.table)}</code> references <code className="font-mono">{short(m.parent)}</code>
              </span>
            }
            actions={
              <>
                {m.existing > 0 ? (
                  <span className="flex items-center gap-1 text-xs text-ok">
                    <Check className="size-3.5" aria-hidden /> using {fmt(m.existing)}
                    {m.capped ? "+" : ""} existing rows
                  </span>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => st.setSelected([...selected, m.parent])}>
                  Add {short(m.parent)}
                </Button>
              </>
            }
          >
            {m.existing > 0
              ? `Rows will point at the ${fmt(m.existing)}${m.capped ? "+" : ""} that already exist in the database.`
              : `${short(m.parent)} is not selected and has no rows, so these foreign keys cannot be filled. Add it to the selection.`}
          </Banner>
        ))}
        {(plan?.errors ?? []).map((e) => (
          <Banner key={e.message} tone="danger">
            {e.message}
          </Banner>
        ))}
        {generateError ? (
          <Banner tone="danger" title="Could not generate">
            {generateError}
          </Banner>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Notes notes={[...new Set([...(session?.db.warnings ?? []), ...(plan?.warnings ?? []), ...(preview?.warnings ?? [])])]} />

        <StudioSettings />

        {generating && !preview ? (
          <div className="space-y-2 rounded-lg border border-line-strong bg-surface p-4" aria-busy="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <OutputPane
            text={preview?.text ?? ""}
            format={preview?.format ?? settings.format}
            empty={
              <div className="space-y-2 px-6">
                <p className="text-ink">Nothing generated yet</p>
                <p>Choose tables and settings, then press Generate. The same seed always gives the same data.</p>
              </div>
            }
          />
        )}

        {preview?.stats.truncated && !st.showAll ? (
          <p className="-mt-2 text-xs text-faint">
            Showing the first {fmt(preview.stats.previewRows)} rows of each table.{" "}
            <button className="text-muted underline underline-offset-2 hover:text-ink" onClick={() => void generate({ all: true })}>
              Show all
            </button>{" "}
            (up to 20,000 rows per table; download for more).
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] text-muted">
            {generating ? <Spinner /> : null}
            <span>
              <span className="text-ink">{selected.length}</span> table{selected.length === 1 ? "" : "s"} · <span className="text-ink">{fmt(totalRows)}</span> rows
              {preview ? <> · ~{bytes(preview.stats.estimatedBytes)}</> : null}
            </span>
            <span className="text-faint">·</span>
            <span className="font-mono text-xs text-faint">Deterministic · seed {settings.seed}</span>
            {stale ? <span className="rounded bg-warn/15 px-2 py-0.5 text-xs text-warn">Settings changed. Generate again.</span> : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              disabled={!preview}
              onClick={async () => {
                if (!preview) return;
                try {
                  await navigator.clipboard.writeText(preview.stats.truncated ? await fullText() : preview.text);
                  setCopied(true);
                  void logCopy();
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  setError("The browser blocked clipboard access. Use Download instead.");
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              icon={<Download className="size-4" aria-hidden />}
              disabled={selected.length === 0 || blocked}
              onClick={() => download().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
            >
              Download .{settings.format === "csv" ? "zip" : settings.format}
            </Button>
            <Button size="sm" variant="danger" icon={<TriangleAlert className="size-4" aria-hidden />} disabled={!canInsert} onClick={() => st.setInsert({ stage: "confirm" })} title={!preview ? "Generate first" : stale ? "Generate again: settings changed" : undefined}>
              Insert into DB
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </main>
      <InsertDialog />
    </div>
  );
}

/** Things Postseed approximated or skipped: shown once, collapsed, so they are never a surprise at insert time. */
function Notes({ notes }: { notes: string[] }): ReactNode {
  if (notes.length === 0) return null;
  return (
    <details className="group rounded-lg border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ink">
        <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
        <span className="font-medium">
          {notes.length} note{notes.length === 1 ? "" : "s"} about this schema
        </span>
        <span className="ml-auto text-xs text-muted group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-muted">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-2 pl-6 text-xs text-faint">A dry run checks the real database, so anything listed here is validated before a single row is kept.</p>
    </details>
  );
}

/** The complete script, for Copy when the preview shows only the first rows. */
async function fullText(): Promise<string> {
  const { selected, settings } = useStudio.getState();
  const r = await api<{ text: string }>("/api/generate", { ...requestOf(selected, settings), format: settings.format, previewRows: "all" });
  return r.text;
}

function ResultView(): ReactNode {
  return (
    <div className="flex min-h-0 flex-1">
      <TableSidebar />
      <SuccessPanel />
    </div>
  );
}

const short = (key: string): string => key.replace(/^public\./, "");

function isNullableFk(db: { tables: Array<{ schema: string; name: string; columns: Array<{ name: string; nullable: boolean }> }> } | undefined, table: string, columns: string[]): boolean {
  const t = db?.tables.find((x) => `${x.schema}.${x.name}` === table);
  return !!t && columns.every((c) => t.columns.find((x) => x.name === c)?.nullable === true);
}
