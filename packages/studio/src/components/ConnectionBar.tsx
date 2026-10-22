import clsx from "clsx";
import { Plus, RefreshCw, Repeat, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { disconnect } from "../lib/actions";
import { useStudio } from "../lib/store";
import type { SessionPayload } from "../lib/types";
import { Button, Pill } from "../shared/ui";

export function ConnectionBar(): ReactNode {
  const { session, setSession } = useStudio();
  const c = session?.connection;
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface px-5 text-[13px]">
      <span className="flex items-center gap-2">
        <span aria-hidden className={clsx("size-2 rounded-full", c ? "bg-ok" : "bg-faint")} />
        <span className="font-medium text-ink">{c ? "Connected" : "Not connected"}</span>
      </span>
      {c ? (
        <>
          <code className="max-w-[44ch] truncate rounded-md border border-line-strong bg-raised px-2.5 py-1 font-mono text-xs text-muted" title={c.redactedUrl}>
            {c.redactedUrl}
          </code>
          <span className="text-faint">
            schema: <span className="font-mono text-muted">{c.schema}</span>
          </span>
          {!c.isLocal ? <Pill tone="warn">Remote host</Pill> : null}
          {c.looksProduction ? <Pill tone="danger">Looks like production</Pill> : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="size-3.5" aria-hidden />}
              onClick={async () => setSession(await api<SessionPayload>("/api/refresh", {}))}
            >
              Refresh schema
            </Button>
            <Button size="sm" variant="secondary" icon={<Repeat className="size-3.5" aria-hidden />} onClick={() => void disconnect()}>
              Switch connection
            </Button>
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => void disconnect()}>
              Add connection
            </Button>
          </div>
        </>
      ) : (
        <Pill className="ml-auto" tone="ok">
          <ShieldCheck className="size-3.5" aria-hidden />
          Localhost only · nothing leaves your machine
        </Pill>
      )}
    </div>
  );
}
