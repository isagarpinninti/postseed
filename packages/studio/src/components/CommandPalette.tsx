import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Database, FileCode, ListChecks, Moon, Play, Sun } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { tableKey } from "../lib/keys";
import { api } from "../lib/api";
import { connect, disconnect, generate } from "../lib/actions";
import { useStudio } from "../lib/store";
import type { SavedConnection, Tab } from "../lib/types";

const TABS: Array<[Tab, string]> = [
  ["tables", "Tables"],
  ["templates", "Templates"],
  ["history", "History"],
  ["docs", "Docs"],
];

export function CommandPalette(): ReactNode {
  const s = useStudio();
  const saved = useQuery({ queryKey: ["connections"], queryFn: () => api<{ connections: SavedConnection[] }>("/api/connections"), enabled: s.paletteOpen });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStudio.getState().setPalette(!useStudio.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const done = (fn: () => void | Promise<void>) => (): void => {
    s.setPalette(false);
    void fn();
  };

  const tables = s.session?.db.tables ?? [];
  return (
    <Command.Dialog open={s.paletteOpen} onOpenChange={s.setPalette} label="Command palette" className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-[2px]" overlayClassName="hidden" contentClassName="">
      <div className="pop w-[min(560px,100%)] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl">
        <Command.Input autoFocus placeholder="Type a command or search tables…" className="h-12 w-full border-b border-line bg-transparent px-4 text-sm text-ink placeholder:text-faint focus:outline-none" />
        <Command.List className="max-h-[50vh] overflow-auto p-2 text-[13px]">
          <Command.Empty className="px-3 py-6 text-center text-faint">No matching command.</Command.Empty>
          <Group title="Connection">
            {(saved.data?.connections ?? []).map((c) => (
              <Item key={c.id} value={`connect ${c.name} ${c.redactedUrl}`} onSelect={done(() => connect({ connectionId: c.id }).then(() => undefined))} icon={<Database className="size-4" aria-hidden />}>
                Connect to {c.name}
              </Item>
            ))}
            {s.session ? (
              <Item value="switch connection disconnect" onSelect={done(disconnect)} icon={<Database className="size-4" aria-hidden />}>
                Switch connection
              </Item>
            ) : null}
          </Group>
          {s.session ? (
            <Group title="Generate">
              <Item value="generate seed data" onSelect={done(() => generate())} icon={<Play className="size-4" aria-hidden />}>
                Generate
              </Item>
              <Item value="select all tables" onSelect={done(() => s.setSelected(tables.map(tableKey)))} icon={<ListChecks className="size-4" aria-hidden />}>
                Select all tables
              </Item>
              <Item value="clear table selection deselect" onSelect={done(() => s.setSelected([]))} icon={<ListChecks className="size-4" aria-hidden />}>
                Clear table selection
              </Item>
              {(["sql", "json", "csv"] as const).map((f) => (
                <Item key={f} value={`format ${f}`} onSelect={done(() => s.patchSettings({ format: f }))} icon={<FileCode className="size-4" aria-hidden />}>
                  Output format: {f.toUpperCase()}
                </Item>
              ))}
            </Group>
          ) : null}
          {s.session && tables.length > 0 ? (
            <Group title="Tables">
              {tables.map((t) => {
                const k = tableKey(t);
                return (
                  <Item key={k} value={`toggle table ${k}`} onSelect={done(() => s.toggleTable(k))} icon={<ListChecks className="size-4" aria-hidden />}>
                    {s.selected.includes(k) ? "Deselect" : "Select"} <span className="font-mono">{t.name}</span>
                  </Item>
                );
              })}
            </Group>
          ) : null}
          <Group title="Go to">
            {TABS.map(([id, label]) => (
              <Item key={id} value={`go to ${label}`} onSelect={done(() => s.setTab(id))}>
                {label}
              </Item>
            ))}
          </Group>
          <Group title="Appearance">
            <Item value="toggle theme dark light" onSelect={done(() => s.setTheme(s.theme === "dark" ? "light" : "dark"))} icon={s.theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}>
              Switch to {s.theme === "dark" ? "light" : "dark"} theme
            </Item>
          </Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }): ReactNode => (
  <Command.Group heading={title} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint">
    {children}
  </Command.Group>
);

const Item = ({ children, icon, value, onSelect }: { children: ReactNode; icon?: ReactNode; value: string; onSelect: () => void }): ReactNode => (
  <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-muted aria-selected:bg-raised aria-selected:text-ink">
    {icon ?? <span className="size-4" aria-hidden />}
    {children}
  </Command.Item>
);
