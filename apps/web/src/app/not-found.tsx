import Link from "next/link";
import type { ReactNode } from "react";

export default function NotFound(): ReactNode {
  return (
    <div className="mx-auto max-w-xl px-5 py-32 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 text-muted">That page does not exist. Try the <Link href="/docs/quickstart/" className="text-ink underline underline-offset-4">quickstart</Link> or the <Link href="/#playground" className="text-ink underline underline-offset-4">Playground</Link>.</p>
    </div>
  );
}
