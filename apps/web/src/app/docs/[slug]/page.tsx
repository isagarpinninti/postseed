import { compileMDX } from "next-mdx-remote/rsc";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { listDocs, readDoc } from "../../../lib/docs";

export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return listDocs().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = listDocs().find((p) => p.slug === slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }): Promise<ReactNode> {
  const { slug } = await params;
  const pages = listDocs();
  const index = pages.findIndex((p) => p.slug === slug);
  if (index < 0) notFound();
  const { content } = await compileMDX({
    source: readDoc(slug),
    components: {
      a: ({ href = "", children }) => (href.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} rel="noreferrer noopener">{children}</a>),
      // Scrollable regions must be reachable by keyboard: code blocks and wide tables get a tab stop.
      pre: (props) => <pre tabIndex={0} {...props} />,
      table: (props) => (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
          <table {...props} />
        </div>
      ),
    },
  });
  const prev = pages[index - 1];
  const next = pages[index + 1];
  return (
    <>
      {content}
      <nav aria-label="Pagination" className="mt-14 flex justify-between gap-4 border-t border-line pt-6 text-sm">
        {prev ? <Link href={`/docs/${prev.slug}/`} className="!no-underline">← {prev.title}</Link> : <span />}
        {next ? <Link href={`/docs/${next.slug}/`} className="!no-underline">{next.title} →</Link> : <span />}
      </nav>
    </>
  );
}
