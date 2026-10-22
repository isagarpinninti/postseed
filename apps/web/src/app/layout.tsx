import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer";
import { SiteHeader } from "../components/SiteHeader";
import { THEME_SCRIPT } from "../lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL when you deploy; it is only used to build absolute URLs in page metadata.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Postseed: realistic Postgres seed data. In seconds.", template: "%s · Postseed" },
  description: "Paste a schema or point at your database. Postseed respects your foreign keys, enums and uniqueness, and never leaves your machine.",
  icons: { icon: "/favicon.svg" },
  openGraph: { title: "Postseed", description: "Realistic Postgres seed data. In seconds.", type: "website" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { colorScheme: "dark light", themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0a0a0b" }, { media: "(prefers-color-scheme: light)", color: "#ffffff" }] };

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
          Skip to content
        </a>
        <SiteHeader />
        <main id="content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
