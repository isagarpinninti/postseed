"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { TEMPLATES } from "@postseed/core";
import type { ClientOutcome, ClientRequest } from "@postseed/studio/shared/clientGen";
import { Workbench, type Runner } from "@postseed/studio/shared/Workbench";
import type { WorkerRequest, WorkerResponse } from "../lib/playground.worker";

/** A Web Worker behind the same `Runner` signature Studio uses on the page. */
function useWorkerRunner(): Runner {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (o: ClientOutcome) => void>());
  const counter = useRef(0);
  return useMemo<Runner>(
    () => (request: ClientRequest) =>
      new Promise<ClientOutcome>((resolve) => {
        if (!worker.current) {
          worker.current = new Worker(new URL("../lib/playground.worker.ts", import.meta.url), { type: "module" });
          worker.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
            pending.current.get(e.data.id)?.(e.data.outcome);
            pending.current.delete(e.data.id);
          };
        }
        const id = ++counter.current;
        pending.current.set(id, resolve);
        worker.current.postMessage({ id, request } satisfies WorkerRequest);
      }),
    [],
  );
}

export default function PlaygroundApp({ initialTemplate = "ecommerce" }: { initialTemplate?: string }): ReactNode {
  const run = useWorkerRunner();
  const [id, setId] = useState(initialTemplate);
  const template = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
  return (
    <div className="flex flex-col gap-4" data-testid="playground">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Example schemas">
        <span className="mr-1 text-[13px] text-muted">Start from</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setId(t.id)}
            aria-pressed={t.id === id}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${t.id === id ? "border-ink bg-accent text-on-accent" : "border-line-strong bg-surface text-muted hover:text-ink"}`}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="flex h-[820px] min-h-0 flex-col lg:h-[700px]">
        {template ? <Workbench initialSql={template.sql} initialRows={template.recommendedRows} run={run} autoRun /> : null}
      </div>
    </div>
  );
}
