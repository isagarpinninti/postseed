import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Kbd } from "../shared/ui";

const REPO = "https://github.com/isagarpinninti/postseed";

const LINKS = [
  { label: "Quickstart", href: `${REPO}#quickstart` },
  { label: "Configuration reference", href: `${REPO}/blob/main/docs/CONFIG.md` },
  { label: "Determinism guarantees", href: `${REPO}/blob/main/docs/DETERMINISM.md` },
  { label: "Security model", href: `${REPO}/blob/main/docs/SECURITY_MODEL.md` },
  { label: "FAQ", href: `${REPO}/blob/main/docs/FAQ.md` },
];

export function DocsScreen(): ReactNode {
  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Docs</h1>
          <p className="mt-0.5 text-[13px] text-muted">The essentials, offline. The full documentation lives with the project.</p>
        </div>

        <section className="space-y-2" aria-labelledby="d-how">
          <h2 id="d-how" className="text-base font-semibold">How a run works</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>Studio reads tables, enums, foreign keys and unique constraints from <code className="font-mono text-ink">pg_catalog</code>.</li>
            <li>Tables are ordered parents-first. Cycles are broken with NULL-then-UPDATE or deferred constraints.</li>
            <li>Every column has its own seeded stream, so the same schema, seed and version give byte-identical output.</li>
            <li>Insert runs in one transaction. Any failure rolls everything back and names the table, row and constraint.</li>
          </ol>
        </section>

        <section className="space-y-2" aria-labelledby="d-safe">
          <h2 id="d-safe" className="text-base font-semibold">Safety</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted">
            <li>Studio listens on 127.0.0.1 only and every request carries a one-time token. Other hosts and websites cannot reach it.</li>
            <li>Connection strings are never logged. Passwords are shown as <code className="font-mono text-ink">•••</code>.</li>
            <li>Use a <strong className="text-ink">dry run</strong> first. It runs the real inserts and rolls back, so CHECK, unique and foreign keys are validated against your database.</li>
            <li><code className="font-mono text-ink">TRUNCATE</code> is opt-in and needs the database name typed in full.</li>
            <li>Prefer a least-privilege role: <code className="font-mono text-ink">INSERT</code> on the seeded tables, <code className="font-mono text-ink">USAGE</code> on their sequences, and <code className="font-mono text-ink">SELECT</code> to read keys.</li>
          </ul>
        </section>

        <section className="space-y-2" aria-labelledby="d-keys">
          <h2 id="d-keys" className="text-base font-semibold">Keyboard</h2>
          <p className="text-[13px] text-muted">
            <Kbd>⌘ K</Kbd> or <Kbd>Ctrl K</Kbd> opens the command palette: switch connection, select tables, generate, change format, change theme.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="d-config">
          <h2 id="d-config" className="text-base font-semibold">Command line</h2>
          <pre className="overflow-x-auto rounded-lg border border-line-strong bg-surface p-4 font-mono text-xs leading-6 text-muted">{`npx postseed generate --schema ./schema.sql --rows 50 --seed 42
npx postseed insert --url $DATABASE_URL --dry-run
npx postseed insert --url $DATABASE_URL --yes
npx postseed init   # writes postseed.config.ts`}</pre>
        </section>

        <section className="space-y-2" aria-labelledby="d-links">
          <h2 id="d-links" className="text-base font-semibold">More</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noreferrer noopener" className="flex items-center justify-between rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-[13px] text-ink transition-colors hover:bg-raised">
                  {l.label}
                  <ExternalLink className="size-3.5 text-faint" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
