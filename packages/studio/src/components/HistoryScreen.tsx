import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { tableKey } from "../lib/keys";
import { api } from "../lib/api";
import { ago, fmt } from "../lib/scale";
import { useStudio } from "../lib/store";
import type { HistoryEntry } from "../lib/types";
import { Button, Pill, Skeleton } from "../shared/ui";

const ACTION: Record<HistoryEntry["action"], { label: string; tone: "neutral" | "ok" | "warn" }> = {
  insert: { label: "Inserted", tone: "ok" },
  "dry-run": { label: "Dry run", tone: "neutral" },
  download: { label: "Downloaded", tone: "neutral" },
  copy: { label: "Copied", tone: "neutral" },
};

export function HistoryScreen(): ReactNode {
  const { session, setSelected, patchSettings, setTab, setPreview } = useStudio();
  const q = useQuery({ queryKey: ["history"], queryFn: () => api<{ history: HistoryEntry[] }>("/api/history"), refetchOnMount: "always" });

  const rerun = (h: HistoryEntry): void => {
    const known = new Set(session?.db.tables.map(tableKey) ?? []);
    const keep = h.tables.filter((t) => known.has(t));
    if (session && keep.length > 0) setSelected(keep);
    patchSettings({ seed: h.seed, rows: h.settings.rowsPerTable, nullRatio: h.settings.nullRatio, format: h.format, tableRows: h.settings.tableRows ?? {} });
    setPreview(null);
    setTab("tables");
  };

  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-0.5 text-[13px] text-muted">Every insert, dry run, download and copy from this machine. Passwords are never recorded. Re-run any of them with the same seed.</p>
        </div>
        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : q.data && q.data.history.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-line-strong">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-line bg-surface text-xs text-faint">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Connection</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Tables</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Rows</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Seed</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Format</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Action</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Re-run</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.history.map((h) => (
                  <tr key={h.id} className="hover:bg-surface">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted" title={new Date(h.at).toLocaleString()}>{ago(h.at)}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-xs text-muted" title={h.connection}>{h.connectionName}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-xs" title={h.tables.join(", ")}>{h.tables.map((t) => t.replace(/^public\./, "")).join(", ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{h.rows ? fmt(h.rows) : "·"}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{h.seed}</td>
                    <td className="px-4 py-2.5 uppercase text-muted">{h.format}</td>
                    <td className="px-4 py-2.5"><Pill tone={ACTION[h.action].tone}>{ACTION[h.action].label}</Pill></td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" icon={<Play className="size-3.5" aria-hidden />} onClick={() => rerun(h)}>
                        Re-run with same seed
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
            <p className="text-sm text-ink">Nothing here yet</p>
            <p className="mt-1 text-[13px] text-faint">Runs show up after you insert, dry-run, download or copy data from the Tables tab.</p>
          </div>
        )}
      </div>
    </main>
  );
}
