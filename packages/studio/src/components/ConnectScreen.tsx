import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Database, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api } from "../lib/api";
import { connect } from "../lib/actions";
import { ago } from "../lib/scale";
import type { SavedConnection } from "../lib/types";
import { Banner, Button, Checkbox, Field, IconButton, Input, Skeleton } from "../shared/ui";

export function ConnectScreen(): ReactNode {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [schema, setSchema] = useState("public");
  const [name, setName] = useState("");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [manage, setManage] = useState(false);
  const saved = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: SavedConnection[] }>("/api/connections") });

  const run = async (label: string, body: Parameters<typeof connect>[0]): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await connect(body);
      await qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, ...(e.hint ? { hint: e.hint } : {}) } : { message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const typed = url.trim();
    const full = /^postgres(ql)?:\/\//i.test(typed) ? typed : `postgres://${typed}`;
    void run("new", { url: full, schema, save, ...(name.trim() ? { name: name.trim() } : {}) });
  };

  return (
    <main className="flex-1 overflow-auto px-6 py-12">
      <div className="mx-auto w-full max-w-[600px] space-y-8">
        <form onSubmit={submit} className="space-y-5 rounded-xl border border-line-strong bg-surface p-7" aria-labelledby="connect-title">
          <div>
            <h1 id="connect-title" className="text-xl font-semibold tracking-tight">
              Connect to a database
            </h1>
            <p className="mt-1 text-[13px] text-muted">Postseed reads your schema, then writes generated rows in one transaction. Everything stays on this machine.</p>
          </div>
          <Field label="Connection string" htmlFor="conn-url" hint="For example user:password@localhost:5432/mydb">
            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-line-strong bg-surface focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/30">
                <span aria-hidden className="select-none pl-3 font-mono text-[13px] text-faint">
                  postgres://
                </span>
                <input
                  id="conn-url"
                  value={url.replace(/^postgres(ql)?:\/\//i, "")}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="user:password@localhost:5432/mydb"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  className="h-9 min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[13px] text-ink placeholder:text-faint focus:outline-none"
                />
              </div>
              <Button
                icon={<ClipboardPaste className="size-4" aria-hidden />}
                onClick={async () => {
                  try {
                    setUrl((await navigator.clipboard.readText()).trim());
                  } catch {
                    setError({ message: "The browser blocked clipboard access. Paste with the keyboard instead." });
                  }
                }}
              >
                Paste
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Schema" htmlFor="conn-schema" hint="Comma-separated for more than one">
              <Input id="conn-schema" value={schema} onChange={(e) => setSchema(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Save as" htmlFor="conn-name" hint="A label for the recent list">
              <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Local dev" />
            </Field>
          </div>
          <div className="space-y-1">
            <Checkbox checked={save} onChange={setSave} label="Save this connection to ~/.postseed/connections.json" description="Passwords are stored locally with mode 0600" />
          </div>
          {error ? (
            <Banner tone="danger" title={error.message}>
              {error.hint}
            </Banner>
          ) : null}
          <Button type="submit" variant="primary" loading={busy === "new"} disabled={!url.trim()} className="w-full">
            Connect
          </Button>
        </form>

        <section aria-labelledby="recent-title" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="recent-title" className="text-sm font-medium">
              Recent connections
            </h2>
            {saved.data && saved.data.connections.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setManage(!manage)}>
                {manage ? "Done" : "Manage"}
              </Button>
            ) : null}
          </div>
          {saved.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : saved.data && saved.data.connections.length > 0 ? (
            <ul className="space-y-2">
              {saved.data.connections.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                  <Database className="size-4 shrink-0 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate font-mono text-xs text-faint">{c.redactedUrl}</p>
                  </div>
                  <span className="hidden text-xs text-faint sm:inline">{ago(c.lastUsedAt)}</span>
                  {manage ? (
                    <IconButton
                      label={`Delete ${c.name}`}
                      onClick={async () => {
                        await api(`/api/connections/${c.id}`, undefined, "DELETE");
                        await qc.invalidateQueries({ queryKey: ["connections"] });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  ) : (
                    <Button size="sm" loading={busy === c.id} onClick={() => void run(c.id, { connectionId: c.id })}>
                      Connect
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-faint">No saved connections yet. Try a template from the Templates tab to explore without a database.</p>
          )}
        </section>
      </div>
    </main>
  );
}
