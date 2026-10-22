import { CheckCircle2, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { fmt } from "../lib/scale";
import { useStudio } from "../lib/store";
import { Banner, Button } from "../shared/ui";

const short = (key: string): string => key.replace(/^public\./, "");

/** S4: what happened. Success (committed or dry run) and failure share one panel. */
export function SuccessPanel(): ReactNode {
  const { insert, resetInsert, setInsert, setPreview, patchSettings, settings, session } = useStudio();
  const database = session?.connection.database ?? "";

  if (insert.stage === "failed" && insert.error) {
    const e = insert.error;
    return (
      <main className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-8">
        <div className="pop w-full max-w-[640px] space-y-5 rounded-xl border border-line-strong bg-surface p-8">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 size-6 shrink-0 text-danger-ink" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{e.dryRun ? "The dry run found a problem" : "Nothing was inserted"}</h1>
              <p className="mt-1 text-[13px] text-muted">{e.dryRun ? "A real insert would fail the same way. Your database was not changed." : "The transaction was rolled back. Your database is exactly as it was."}</p>
            </div>
          </div>
          <Banner tone="danger" title={e.message} />
          {e.details && (e.details.table || e.details.constraint || e.details.rowIndex) ? (
            <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-bg p-4 text-[13px]">
              {e.details.table ? (
                <>
                  <dt className="text-faint">Table</dt>
                  <dd className="font-mono">{e.details.table}</dd>
                </>
              ) : null}
              {e.details.rowIndex ? (
                <>
                  <dt className="text-faint">Row</dt>
                  <dd className="font-mono">{fmt(e.details.rowIndex)}</dd>
                </>
              ) : null}
              {e.details.constraint ? (
                <>
                  <dt className="text-faint">Constraint</dt>
                  <dd className="font-mono">{e.details.constraint}</dd>
                </>
              ) : null}
              {e.details.detail ? (
                <>
                  <dt className="text-faint">Detail</dt>
                  <dd className="font-mono text-muted">{e.details.detail}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" onClick={resetInsert}>
              Back to Studio
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const r = insert.result;
  if (!r) return null;
  const max = Math.max(1, ...r.tables.map((t) => t.rows));
  return (
    <main className="flex min-w-0 flex-1 items-start justify-center overflow-auto p-8">
      <div className="pop w-full max-w-[640px] space-y-5 rounded-xl border border-line-strong bg-surface p-8">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{r.dryRun ? `Dry run passed: ${fmt(r.totalRows)} rows are valid` : `Inserted ${fmt(r.totalRows)} rows in ${(r.ms / 1000).toFixed(1)}s`}</h1>
            <p className="mt-1 text-[13px] text-muted">
              {r.dryRun ? `Every constraint was checked against ${database}, then rolled back. Nothing was changed.` : `Transaction committed to ${database}. Nothing else was touched.`}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-line rounded-lg border border-line bg-bg">
          {r.tables.map((t) => (
            <li key={t.key} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
              <span className="w-36 truncate font-mono text-muted">{short(t.key)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(3, Math.round((t.rows / max) * 100))}%` }} />
              </span>
              <span className="w-14 text-right tabular-nums">{fmt(t.rows)}</span>
              <span className="w-14 text-right tabular-nums text-faint">{t.ms} ms</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">{r.dryRun ? "Dry runs are recorded in History." : "Added to history."}</p>
        <div className="flex flex-wrap gap-2">
          {r.dryRun ? (
            <Button variant="danger" onClick={() => setInsert({ stage: "confirm" })}>
              Run the real insert
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                patchSettings({ seed: (settings.seed + 1) % 2_147_483_647 });
                setPreview(null);
                resetInsert();
              }}
            >
              Generate another batch
            </Button>
          )}
          <Button variant="secondary" onClick={resetInsert}>
            View in Studio
          </Button>
        </div>
      </div>
    </main>
  );
}
