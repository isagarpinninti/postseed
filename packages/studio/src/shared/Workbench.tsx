import { Check, Copy, Download, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseDdl } from "@postseed/core";
import { bytes, fmt } from "../lib/scale";
import type { Format } from "../lib/types";
import { OutputPane } from "./OutputPane";
import { SchemaEditor } from "./SchemaEditor";
import { buildFile, runClient, type ClientOutcome, type ClientRequest } from "./clientGen";
import { Banner, Button, Spinner } from "./ui";
import { SettingsStrip } from "../components/SettingsStrip";
import { saveBlob } from "../lib/download";

export type Runner = (r: ClientRequest) => Promise<ClientOutcome>;

/** Runs on the page itself. The Playground swaps in a Web Worker with the same signature. */
export const runInPage: Runner = async (r) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return runClient(r);
};

/**
 * Schema editor + settings + output, with no server and no database. Used by Studio's Templates tab and
 * by the website Playground, so what visitors try is exactly what ships.
 */
export function Workbench({ initialSql, initialRows = 50, run = runInPage, autoRun = false, extra }: { initialSql: string; initialRows?: number; run?: Runner; autoRun?: boolean; extra?: ReactNode }): ReactNode {
  const [ddl, setDdl] = useState(initialSql);
  const [settings, setSettings] = useState<{ rows: number; seed: number; nullRatio: number; format: Format }>({ rows: initialRows, seed: 42, nullRatio: 0.1, format: "sql" });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ClientOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const counter = useRef(0);

  const parsed = useMemo(() => parseDdl(ddl), [ddl]);

  const go = async (source: string = ddl, current: typeof settings = settings): Promise<void> => {
    const id = ++counter.current;
    setBusy(true);
    const result = await run({ ddl: source, ...current });
    if (id === counter.current) {
      setOutcome(result);
      setBusy(false);
    }
  };

  // A new starting schema (including the first one) replaces the editor, resets the row count to the template's
  // recommendation and, when asked for (the Playground), generates straight away so the output never goes stale.
  const initial = useRef(true);
  useEffect(() => {
    const next = { ...settings, rows: initialRows };
    setDdl(initialSql);
    setSettings(next);
    setOutcome(null);
    setDownloadError(null);
    if (autoRun) void go(initialSql, next);
    else if (!initial.current) setBusy(false);
    initial.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSql, initialRows]);

  const result = outcome?.ok ? outcome.result : null;
  const warnings = outcome?.ok ? outcome.result.warnings : parsed.warnings;
  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
      <section aria-label="Schema" className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Schema <span className="font-normal text-faint">· {parsed.tables.length} table{parsed.tables.length === 1 ? "" : "s"}, {parsed.enums.length} enum{parsed.enums.length === 1 ? "" : "s"}</span>
          </h2>
          {extra}
        </div>
        <div className="min-h-[260px] flex-1">
          <SchemaEditor value={ddl} onChange={setDdl} />
        </div>
        {warnings.length > 0 ? (
          <Banner tone="warn" title={`${warnings.length} thing${warnings.length === 1 ? " was" : "s were"} skipped or approximated`}>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {warnings.slice(0, 4).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {warnings.length > 4 ? <li>…and {warnings.length - 4} more</li> : null}
            </ul>
          </Banner>
        ) : null}
      </section>
      <section aria-label="Output" className="flex min-h-0 flex-col gap-3">
        <SettingsStrip settings={settings} onChange={(p) => setSettings({ ...settings, ...p })} />
        <div className="flex items-center gap-2">
          <Button variant="primary" icon={busy ? undefined : <Sparkles className="size-4" aria-hidden />} loading={busy} onClick={() => void go()} disabled={!ddl.trim()}>
            Generate
          </Button>
          <Button
            icon={copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            disabled={!result}
            onClick={async () => {
              if (!result) return;
              try {
                await navigator.clipboard.writeText(result.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setDownloadError("The browser blocked clipboard access.");
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            icon={<Download className="size-4" aria-hidden />}
            disabled={!result}
            onClick={() => {
              const f = buildFile({ ddl, ...settings });
              if ("error" in f) setDownloadError(f.error);
              else saveBlob(f.blob, f.name);
            }}
          >
            Download .{settings.format === "csv" ? "zip" : settings.format}
          </Button>
          {busy ? <Spinner className="text-muted" /> : null}
          {result ? (
            <span className="ml-auto font-mono text-xs text-faint">
              {fmt(result.rows)} rows · ~{bytes(result.bytes)} · {result.ms} ms · seed {settings.seed}
            </span>
          ) : null}
        </div>
        {outcome && !outcome.ok ? <Banner tone="danger" title="Could not generate">{outcome.error}</Banner> : null}
        {downloadError ? <Banner tone="danger">{downloadError}</Banner> : null}
        <OutputPane text={result?.text ?? ""} format={settings.format} empty="Press Generate to see rows. Nothing leaves this page." />
        {result?.truncated ? <p className="-mt-1 text-xs text-faint">Showing the first 200 rows of each table. Download for everything.</p> : null}
      </section>
    </div>
  );
}
