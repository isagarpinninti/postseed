import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { runInsert } from "../lib/actions";
import { fmt } from "../lib/scale";
import { useStudio } from "../lib/store";
import { Banner, Button, Checkbox, Input, Modal, Spinner } from "../shared/ui";

const short = (key: string): string => key.replace(/^public\./, "");

/** S3: the last stop before anything is written. Also shows live progress while the insert runs. */
export function InsertDialog(): ReactNode {
  const { insert, setInsert, session, plan, selected, settings, preview } = useStudio();
  const [truncate, setTruncate] = useState(false);
  const [typed, setTyped] = useState("");
  const open = insert.stage === "confirm" || insert.stage === "running";
  const c = session?.connection;
  if (!c || !plan) return null;
  const running = insert.stage === "running";
  const total = plan.totalRows;
  const nameOk = !truncate || typed === c.database;
  const close = (): void => {
    setTruncate(false);
    setTyped("");
    setInsert({ stage: "closed" });
  };
  const start = (dryRun: boolean): void => void runInsert({ dryRun, truncate, ...(truncate ? { confirmDatabase: typed } : {}) });

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && !running && close()}
      dismissible={!running}
      width={520}
      title={
        <span className="flex items-center gap-2.5">
          <TriangleAlert className="size-5 text-warn" aria-hidden />
          {running ? (insert.dryRun ? "Running a dry run…" : "Inserting…") : `Insert ${fmt(total)} rows into ${c.database}?`}
        </span>
      }
      description={running ? "Nothing is committed until every table has been inserted." : "All inserts run in a single transaction. If any insert fails, nothing is committed and your database is untouched."}
    >
      {running ? (
        <ul className="space-y-2.5" aria-live="polite">
          {plan.order.map((k) => {
            const p = insert.progress[k];
            const done = p && p.rows >= p.total;
            return (
              <li key={k} className="flex items-center gap-3 text-[13px]">
                {done ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : p ? <Spinner className="text-muted" /> : <span className="size-4 rounded-full border border-line-strong" aria-hidden />}
                <span className="w-32 truncate font-mono text-muted">{short(k)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <span className="block h-full rounded-full bg-ink transition-all" style={{ width: `${p ? Math.round((p.rows / Math.max(1, p.total)) * 100) : 0}%` }} />
                </span>
                <span className="w-16 text-right tabular-nums text-faint">{fmt(p?.rows ?? 0)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 rounded-lg border border-line bg-bg p-4 text-[13px]">
            <dt className="text-faint">Database</dt>
            <dd className="font-mono text-ink">{c.database}</dd>
            <dt className="text-faint">Schema</dt>
            <dd className="font-mono text-ink">{c.schema}</dd>
            <dt className="text-faint">Target tables</dt>
            <dd className="text-ink">
              <ul className="space-y-0.5">
                {plan.order.map((k) => (
                  <li key={k} className="flex justify-between gap-4">
                    <span className="font-mono text-muted">{short(k)}</span>
                    <span className="tabular-nums">{fmt(plan.rows[k] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </dd>
            <dt className="text-faint">Seed</dt>
            <dd className="font-mono text-ink">{settings.seed}</dd>
          </dl>

          {!c.isLocal || c.looksProduction ? (
            <Banner tone="warn" title={c.looksProduction ? "This looks like a production database" : "This is not a local database"}>
              Host <span className="font-mono">{c.host}</span>. Use a dry run first, and a least-privilege role.
            </Banner>
          ) : null}

          <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3.5">
            <Checkbox danger checked={truncate} onChange={(v) => { setTruncate(v); setTyped(""); }} label={<span><span className="font-mono">TRUNCATE</span> target tables first · <span className="text-danger-ink">destructive</span></span>} description="Empties the selected tables (RESTART IDENTITY CASCADE) before inserting." />
            {truncate ? (
              <div className="space-y-2 pl-6">
                {plan.truncateImpact.length > 0 ? <p className="text-xs text-danger-ink">CASCADE will also empty: {plan.truncateImpact.map(short).join(", ")}.</p> : null}
                <label htmlFor="confirm-db" className="block text-xs text-muted">
                  Type <span className="font-mono text-ink">{c.database}</span> to enable the button
                </label>
                <Input id="confirm-db" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
              </div>
            ) : null}
          </div>

          <p className="text-xs text-faint">A dry run inserts everything, checks every constraint against your database, then rolls back. Nothing changes.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" disabled={!nameOk} onClick={() => start(true)} title="Validate every constraint against the real database, then roll back">
              Dry run
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!nameOk || !preview} onClick={() => start(false)}>
                Insert {fmt(total)} rows
              </Button>
            </div>
          </div>
        </div>
      )}
      <span className="sr-only">{selected.length} tables selected</span>
    </Modal>
  );
}
