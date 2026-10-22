"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@postseed/studio/shared/ui";

const PlaygroundApp = dynamic(() => import("./PlaygroundApp"), {
  ssr: false,
  loading: () => <PlaygroundSkeleton />,
});

/** Same height as the loaded Playground, so nothing below it jumps when the engine arrives. */
function PlaygroundSkeleton(): ReactNode {
  return (
    <div className="grid min-h-[890px] content-start gap-4 lg:min-h-[770px] lg:grid-cols-2" role="status" aria-busy="true" aria-label="Loading the Playground">
      <Skeleton className="h-[420px]" />
      <Skeleton className="h-[420px]" />
    </div>
  );
}

/**
 * The real engine is about a megabyte of JavaScript. It starts loading on the visitor's first sign of life
 * (a scroll, tap, click or key press, or arriving at #playground), never during the first paint, so the page
 * itself is instant. People who are reading the page start the download as soon as they scroll.
 */
export function Playground({ initialTemplate }: { initialTemplate?: string }): ReactNode {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (go) return;
    if (window.location.hash === "#playground") {
      setGo(true);
      return;
    }
    const events = ["scroll", "wheel", "touchstart", "pointerdown", "keydown"] as const;
    const start = (): void => setGo(true);
    const onHash = (): void => {
      if (window.location.hash === "#playground") start();
    };
    for (const e of events) window.addEventListener(e, start, { once: true, passive: true });
    window.addEventListener("hashchange", onHash);
    return () => {
      for (const e of events) window.removeEventListener(e, start);
      window.removeEventListener("hashchange", onHash);
    };
  }, [go]);
  return go ? <PlaygroundApp {...(initialTemplate ? { initialTemplate } : {})} /> : <PlaygroundSkeleton />;
}
