import { useQuery } from "@tanstack/react-query";
import { Component, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from "react";
import { api } from "./lib/api";
import { useStudio } from "./lib/store";
import type { SessionPayload } from "./lib/types";
import { CommandPalette } from "./components/CommandPalette";
import { ConnectScreen } from "./components/ConnectScreen";
import { ConnectionBar } from "./components/ConnectionBar";
import { DocsScreen } from "./components/DocsScreen";
import { Header } from "./components/Header";
import { HistoryScreen } from "./components/HistoryScreen";
import { StudioScreen } from "./components/StudioScreen";
const TemplatesScreen = lazy(() => import("./components/TemplatesScreen").then((m) => ({ default: m.TemplatesScreen })));
import { Banner, Button } from "./shared/ui";

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }
  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-8 max-w-xl space-y-3">
        <Banner tone="danger" title="Something went wrong in Studio">
          {this.state.error.message}
        </Banner>
        <Button variant="primary" onClick={() => location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

export function App(): ReactNode {
  const { theme, tab, session, serverDown, setServerDown } = useStudio();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Studio is only a window onto a process in your terminal; say so plainly when that process stops.
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ ok: boolean }>("/api/health"), refetchInterval: 4000, retry: false, refetchIntervalInBackground: true });
  useEffect(() => {
    setServerDown(health.isError);
  }, [health.isError, setServerDown]);

  // A page reload keeps the server-side connection; pick it back up.
  useEffect(() => {
    void api<SessionPayload | { connection: null }>("/api/session")
      .then((s) => {
        if (s.connection && "db" in s) useStudio.getState().setSession(s);
      })
      .catch(() => undefined);
  }, []);

  return (
    <Boundary>
      <div className="flex h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
          Skip to content
        </a>
        <Header />
        {serverDown ? (
          <div className="px-5 pt-3">
            <Banner tone="danger" title="Studio's server has stopped">
              The <code className="font-mono">postseed</code> process in your terminal is no longer running, so nothing here can reach your database. Start it again with <code className="font-mono">npx postseed</code>.
            </Banner>
          </div>
        ) : null}
        <div id="main" className="flex min-h-0 flex-1 flex-col">
          {tab === "tables" ? (
            <>
              <ConnectionBar />
              {session ? <StudioScreen /> : <ConnectScreen />}
            </>
          ) : tab === "templates" ? (
            <Suspense fallback={<div className="p-6 text-sm text-faint">Loading templates…</div>}>
              <TemplatesScreen />
            </Suspense>
          ) : tab === "history" ? (
            <HistoryScreen />
          ) : (
            <DocsScreen />
          )}
        </div>
        <CommandPalette />
      </div>
    </Boundary>
  );
}
