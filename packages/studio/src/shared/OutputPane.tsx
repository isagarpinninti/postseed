import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useMemo, useRef, type ReactNode } from "react";
import { highlight } from "../lib/highlight";
import type { Format } from "../lib/types";

const LINE = 20;

/**
 * The generated script. It is virtualized: only the lines in view are in the DOM, so a very large
 * preview scrolls smoothly. Selectable and copyable like any text.
 */
export function OutputPane({ text, format, empty, className }: { text: string; format: Format; empty?: ReactNode; className?: string }): ReactNode {
  const lines = useMemo(() => (text ? highlight(text, format) : []), [text, format]);
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: lines.length, getScrollElement: () => parent.current, estimateSize: () => LINE, overscan: 24 });
  const gutter = String(lines.length).length;

  if (lines.length === 0) {
    return (
      <div className={clsx("grid min-h-0 flex-1 place-items-center rounded-lg border border-dashed border-line-strong bg-surface text-center text-sm text-faint", className)}>
        {empty ?? "Nothing generated yet."}
      </div>
    );
  }
  return (
    <div
      ref={parent}
      role="region"
      aria-label="Generated output"
      tabIndex={0}
      className={clsx("min-h-0 flex-1 overflow-auto rounded-lg border border-line-strong bg-surface font-mono text-[12.5px] leading-5", className)}
    >
      <div style={{ height: virtual.getTotalSize(), minWidth: "max-content" }} className="relative">
        {virtual.getVirtualItems().map((row) => (
          <div key={row.index} className="absolute left-0 flex w-full whitespace-pre" style={{ top: 0, height: LINE, transform: `translateY(${row.start}px)` }}>
            <span aria-hidden className="sticky left-0 select-none bg-surface pl-3 pr-3 text-right text-faint" style={{ minWidth: `${gutter + 2}ch` }}>
              {row.index + 1}
            </span>
            <span className="pr-6">
              {(lines[row.index] ?? []).map((t, i) => (
                <span key={i} className={t.cls === "plain" ? undefined : `tok-${t.cls}`}>
                  {t.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
