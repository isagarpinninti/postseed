import { ArrowRight, CheckCircle2, Database, GitBranch, Lock, Repeat, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCommand } from "../components/CopyCommand";
import { Playground } from "../components/Playground";

const CHIPS = ["Postgres 15–18", "FK-aware", "Local-first", "Deterministic"];

const STEPS = [
  { n: "1", title: "Point it at a schema", body: "Paste CREATE TABLE statements or connect to a database. Postseed reads tables, enums, foreign keys and unique constraints." },
  { n: "2", title: "Generate", body: "Parents first, every foreign key resolved, every unique value distinct, every enum valid. The same seed gives the same data, every time." },
  { n: "3", title: "Download or insert", body: "Copy SQL, JSON or CSV, or insert in a single transaction. A dry run checks every constraint against your real database, then rolls back." },
];

const FEATURES = [
  { icon: <GitBranch className="size-5" aria-hidden />, title: "Relationship-correct", body: "Never an orphan row. Foreign keys, composite keys, self-references and even cycles are resolved." },
  { icon: <Repeat className="size-5" aria-hidden />, title: "Deterministic", body: "Same schema, seed and version means byte-identical output. Regenerate fixtures in CI instead of committing them." },
  { icon: <ShieldCheck className="size-5" aria-hidden />, title: "Transactional", body: "Inserts are all-or-nothing. If a row fails, nothing is committed and you are told which table, row and constraint." },
  { icon: <Lock className="size-5" aria-hidden />, title: "Local-first", body: "Runs on your machine. No account, no upload, no telemetry. Studio only reaches your own database." },
  { icon: <Database className="size-5" aria-hidden />, title: "Studio, CLI and library", body: "A web app for exploring, a CLI for scripts and CI, and a library for your own tooling." },
  { icon: <Zap className="size-5" aria-hidden />, title: "Fast", body: "Ten tables of 100,000 rows in about five seconds. Thousands of rows in the browser in under a second." },
];

const FAQ = [
  { q: "Does my schema or data leave my machine?", a: "No. The Playground runs in your browser and Studio only talks to the database you give it. There is no telemetry and no account." },
  { q: "Is it safe to run against a real database?", a: "It is built for that: one transaction, a dry run that validates against the real database, and a refusal to truncate unless you type the database name. Still, use a dev or staging database and a least-privilege role." },
  { q: "Why is the output the same every time?", a: "Because every column has its own seeded stream. That makes bugs reproducible (“seed 8123 fails”) and lets CI regenerate fixtures." },
  { q: "What about tables that reference each other?", a: "Postseed orders tables parents-first and breaks cycles by inserting NULL and filling the key in afterwards, or by deferring constraints. If neither is possible it tells you which tables are the problem." },
  { q: "Which databases are supported?", a: "PostgreSQL 15 to 18 are in the automated test matrix. Other databases are not supported." },
  { q: "Is it free?", a: "Yes, MIT licensed and open source." },
];

export default function Home(): ReactNode {
  return (
    <>
      <section className="relative overflow-hidden">
        <div aria-hidden className="grid-dots absolute inset-0" />
        <div aria-hidden className="hero-glow absolute inset-0" />
        <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-20 text-center sm:pt-28">
          <ul className="mb-7 flex flex-wrap items-center justify-center gap-2" aria-label="Highlights">
            {CHIPS.map((c) => (
              <li key={c} className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-muted">
                {c}
              </li>
            ))}
          </ul>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">Realistic Postgres seed data. In seconds.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted sm:text-lg">
            Paste a schema or point at your database. Postseed respects your foreign keys, enums, and uniqueness — and never leaves your machine.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/#playground" className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover">
              Try with example
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <CopyCommand command="npx postseed" />
          </div>
        </div>
      </section>

      <section id="playground" aria-labelledby="pg-title" className="mx-auto max-w-6xl scroll-mt-20 px-5">
        <div className="mb-5">
          <h2 id="pg-title" className="text-xl font-semibold tracking-tight">Playground</h2>
          <p className="mt-1 text-sm text-muted">This is the real engine, running in your browser. Edit the schema, press Generate. Nothing is uploaded.</p>
        </div>
        <Playground />
      </section>

      <section aria-labelledby="how-title" className="mx-auto mt-28 max-w-6xl px-5">
        <h2 id="how-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-line-strong bg-surface p-6">
              <span className="grid size-8 place-items-center rounded-full border border-line-strong bg-bg font-mono text-sm text-ink">{s.n}</span>
              <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="feat-title" className="mx-auto mt-28 max-w-6xl px-5">
        <h2 id="feat-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Built to be trusted with your database</h2>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border border-line bg-surface p-6">
              <span className="grid size-9 place-items-center rounded-lg border border-line-strong bg-bg text-ink">{f.icon}</span>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="studio-title" className="mx-auto mt-28 max-w-6xl px-5">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="studio-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Studio: see it before it touches anything</h2>
          <p className="mt-3 text-sm text-muted sm:text-base">Run <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.85em] text-ink">npx postseed</code> to open Studio on your own machine: pick tables, preview the exact SQL, validate with a dry run, then insert.</p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <figure className="overflow-hidden rounded-xl border border-line-strong bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/screens/02-studio.png" alt="Postseed Studio showing a table list, settings and the generated SQL" width={1440} height={900} loading="lazy" decoding="async" className="h-auto w-full" />
            <figcaption className="border-t border-line px-4 py-3 text-[13px] text-muted">Pick tables, set rows and a seed, preview the SQL.</figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-line-strong bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/screens/05-success.png" alt="Postseed Studio showing 200 rows inserted in one transaction, table by table" width={1440} height={900} loading="lazy" decoding="async" className="h-auto w-full" />
            <figcaption className="border-t border-line px-4 py-3 text-[13px] text-muted">One transaction. Every table accounted for.</figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mx-auto mt-28 max-w-3xl px-5">
        <h2 id="faq-title" className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Questions</h2>
        <div className="mt-8 divide-y divide-line rounded-xl border border-line-strong bg-surface">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
                {f.q}
                <span aria-hidden className="text-faint transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted">
          <CheckCircle2 className="size-4 text-ok" aria-hidden />
          More in the <Link href="/docs/faq/" className="text-ink underline underline-offset-4">documentation</Link>.
        </p>
      </section>
    </>
  );
}
