"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@postseed/studio/shared/ui";
import { THEME_KEY, type Theme } from "../lib/theme";

function GithubMark({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export const REPO = "https://github.com/isagarpinninti/postseed";

export function SiteHeader(): ReactNode {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const toggle = (): void => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage can be blocked */
    }
    setTheme(next);
  };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" aria-label="Postseed home" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 text-sm sm:flex">
          <Link href="/#playground" className="rounded-md px-3 py-1.5 text-muted transition-colors hover:text-ink">
            Playground
          </Link>
          <Link href="/docs/quickstart/" className="rounded-md px-3 py-1.5 text-muted transition-colors hover:text-ink">
            Docs
          </Link>
          <a href={REPO} className="rounded-md px-3 py-1.5 text-muted transition-colors hover:text-ink">
            GitHub
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a href={REPO} aria-label="Postseed on GitHub" className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink sm:hidden">
            <GithubMark />
          </a>
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
        </div>
      </div>
    </header>
  );
}
