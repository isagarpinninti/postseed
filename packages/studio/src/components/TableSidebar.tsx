import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";
import { tableKey } from "../lib/keys";
import { useStudio } from "../lib/store";
import { Checkbox, Input } from "../shared/ui";

const ROW = 36;

export function TableSidebar(): ReactNode {
  const { session, selected, toggleTable, selectAll, filter, setFilter } = useStudio();
  const parent = useRef<HTMLDivElement>(null);
  const tables = useMemo(() => session?.db.tables ?? [], [session]);
  const enums = session?.db.enums ?? [];
  const multiSchema = new Set(tables.map((t) => t.schema)).size > 1;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return tables.filter((t) => !q || `${t.schema}.${t.name}`.toLowerCase().includes(q));
  }, [tables, filter]);
  const virtual = useVirtualizer({ count: visible.length, getScrollElement: () => parent.current, estimateSize: () => ROW, overscan: 12 });
  const allSelected = tables.length > 0 && selected.length === tables.length;

  return (
    <aside aria-label="Tables" className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="space-y-3 p-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Tables <span className="font-normal text-faint">· {tables.length}</span>
          </h2>
          <button onClick={selectAll} className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
            {allSelected ? "Clear" : "Select all"}
          </button>
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
          <Input aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8" />
        </div>
      </div>
      <div ref={parent} className="min-h-0 flex-1 overflow-auto px-2" role="group" aria-label={`${visible.length} tables`}>
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-faint">{tables.length === 0 ? "No tables found in this schema." : "No table matches the filter."}</p>
        ) : (
          <div style={{ height: virtual.getTotalSize() }} className="relative">
            {virtual.getVirtualItems().map((v) => {
              const t = visible[v.index];
              if (!t) return null;
              const key = tableKey(t);
              const on = selected.includes(key);
              return (
                <div
                  key={key}
                  className={clsx("absolute left-0 flex w-full items-center gap-2 rounded-md px-2.5 transition-colors", on ? "bg-raised" : "hover:bg-raised/60")}
                  style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                >
                  <div className="min-w-0 flex-1">
                    <Checkbox
                      checked={on}
                      onChange={() => toggleTable(key)}
                      label={<span className={clsx("font-mono text-[13px]", on ? "text-ink" : "text-muted")}>{multiSchema ? key : t.name}</span>}
                    />
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-faint">{t.columns.length} cols</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="max-h-[34%] overflow-auto border-t border-line p-4">
        <h2 className="mb-2 text-sm font-medium">
          Enums <span className="font-normal text-faint">· {enums.length}</span>
        </h2>
        {enums.length === 0 ? (
          <p className="text-[13px] text-faint">None in this database.</p>
        ) : (
          <ul className="space-y-1.5">
            {enums.map((e) => (
              <li key={`${e.schema}.${e.name}`} className="flex items-center justify-between text-[13px]" title={e.values.join(", ")}>
                <span className="truncate font-mono text-muted">{e.name}</span>
                <span className="text-xs tabular-nums text-faint">{e.values.length} values</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
