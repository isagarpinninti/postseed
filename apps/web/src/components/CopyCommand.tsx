"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

export function CopyCommand({ command }: { command: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard can be blocked; the text is selectable */
        }
      }}
      className="group inline-flex h-11 items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 font-mono text-sm text-ink transition-colors hover:border-faint"
      aria-label={`Copy command: ${command}`}
    >
      <span aria-hidden className="text-faint">$</span>
      <span>{command}</span>
      {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4 text-faint transition-colors group-hover:text-ink" aria-hidden />}
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </button>
  );
}
