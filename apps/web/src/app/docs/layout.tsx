import Link from "next/link";
import type { ReactNode } from "react";
import { listDocs } from "../../lib/docs";

export default function DocsLayout({ children }: { children: ReactNode }): ReactNode {
  const pages = listDocs();
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-faint">Documentation</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 lg:flex-col lg:gap-1">
          {pages.map((p) => (
            <li key={p.slug}>
              <Link href={`/docs/${p.slug}/`} className="block rounded-md py-1.5 text-sm text-muted transition-colors hover:text-ink">
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="prose-docs min-w-0 max-w-3xl">{children}</article>
    </div>
  );
}
