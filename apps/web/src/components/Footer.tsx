import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@postseed/studio/shared/ui";
import { REPO } from "./SiteHeader";

export function Footer(): ReactNode {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-[13px] text-muted">Realistic Postgres seed data. Local-first, deterministic, open source.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px]">
          <Link href="/docs/quickstart/" className="text-muted hover:text-ink">Quickstart</Link>
          <Link href="/docs/config/" className="text-muted hover:text-ink">Configuration</Link>
          <Link href="/docs/determinism/" className="text-muted hover:text-ink">Determinism</Link>
          <Link href="/docs/security-model/" className="text-muted hover:text-ink">Security model</Link>
          <Link href="/docs/faq/" className="text-muted hover:text-ink">FAQ</Link>
          <a href={REPO} className="text-muted hover:text-ink">GitHub</a>
          <a href={`${REPO}/blob/main/CHANGELOG.md`} className="text-muted hover:text-ink">Changelog</a>
          <a href={`${REPO}/issues`} className="text-muted hover:text-ink">Issues</a>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-4 text-xs text-faint">MIT licensed © Sagar Pinninti. No cookies, no analytics, no tracking.</p>
      </div>
    </footer>
  );
}
