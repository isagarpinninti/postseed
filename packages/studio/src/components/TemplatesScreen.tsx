import { ArrowLeft, Layers, ShoppingCart, FileText, Landmark } from "lucide-react";
import { useState, type ReactNode } from "react";
import { TEMPLATES, parseDdl, type Template } from "@postseed/core";
import { Workbench } from "../shared/Workbench";
import { Button } from "../shared/ui";

const ICONS: Record<string, ReactNode> = {
  ecommerce: <ShoppingCart className="size-5" aria-hidden />,
  saas: <Layers className="size-5" aria-hidden />,
  blog: <FileText className="size-5" aria-hidden />,
  fintech: <Landmark className="size-5" aria-hidden />,
};

/** Starter schemas that work without a database: generate, copy and download right here. */
export function TemplatesScreen(): ReactNode {
  const [open, setOpen] = useState<Template | null>(null);

  if (open) {
    return (
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => setOpen(null)}>
            Templates
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{open.name}</h1>
            <p className="text-[13px] text-muted">{open.description}</p>
          </div>
        </div>
        <Workbench initialSql={open.sql} initialRows={open.recommendedRows} autoRun />
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-0.5 text-[13px] text-muted">Realistic starter schemas with recommended row counts. They run entirely in this page, no database needed. Edit them, or paste your own DDL.</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const db = parseDdl(t.sql);
            return (
              <li key={t.id}>
                <button
                  onClick={() => setOpen(t)}
                  className="group flex h-full w-full flex-col gap-3 rounded-xl border border-line-strong bg-surface p-5 text-left transition-colors hover:border-faint hover:bg-raised"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-lg border border-line-strong bg-bg text-ink">{ICONS[t.id]}</span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold tracking-tight">{t.name}</span>
                      <span className="block text-xs text-faint">{t.tag}</span>
                    </span>
                  </span>
                  <span className="text-[13px] text-muted">{t.description}</span>
                  <span className="mt-auto flex items-center gap-3 pt-1 text-xs text-faint">
                    <span>{db.tables.length} tables</span>
                    <span>·</span>
                    <span>{db.enums.length} enums</span>
                    <span>·</span>
                    <span>{t.recommendedRows} rows suggested</span>
                    <span className="ml-auto text-muted opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
