import clsx from "clsx";
import { Moon, Search, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useStudio } from "../lib/store";
import type { Tab } from "../lib/types";
import { IconButton, Kbd, Logo, Pill } from "../shared/ui";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "tables", label: "Tables" },
  { id: "templates", label: "Templates" },
  { id: "history", label: "History" },
  { id: "docs", label: "Docs" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Header(): ReactNode {
  const { tab, setTab, theme, setTheme, setPalette } = useStudio();
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-6 border-b border-line bg-bg px-5">
      <div className="flex items-center gap-3">
        <Logo />
        <Pill>Studio</Pill>
      </div>
      <nav aria-label="Primary" role="tablist" className="flex h-full items-stretch gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "relative px-3 text-sm transition-colors",
              tab === t.id ? "font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {tab === t.id ? <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink" /> : null}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setPalette(true)}
          className="hidden h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] text-faint transition-colors hover:border-faint hover:text-muted sm:flex"
        >
          <Search className="size-3.5" aria-hidden />
          <span>Search or run a command</span>
          <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
        </button>
        <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
        </IconButton>
      </div>
    </header>
  );
}
