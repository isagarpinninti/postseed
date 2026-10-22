import { Dices } from "lucide-react";
import { useState, type ReactNode } from "react";
import { MAX_ROWS, MIN_ROWS, fmt, rowsToSlider, sliderToRows } from "../lib/scale";
import { useStudio } from "../lib/store";
import type { Format } from "../lib/types";
import { IconButton, Input, Segmented, Slider } from "../shared/ui";

const NULL_PRESETS = [0, 0.1, 0.25];

/** Rows, seed, nullability and output format. Used by Studio and by the template workbench. */
export function SettingsStrip({
  settings,
  onChange,
  formats = ["sql", "json", "csv"],
}: {
  settings: { rows: number; seed: number; nullRatio: number; format: Format };
  onChange: (p: Partial<{ rows: number; seed: number; nullRatio: number; format: Format }>) => void;
  formats?: Format[];
}): ReactNode {
  const [custom, setCustom] = useState(!NULL_PRESETS.includes(settings.nullRatio));
  const reroll = (): void => onChange({ seed: Math.floor(Math.random() * 2_147_483_647) });
  return (
    <div className="grid gap-x-6 gap-y-4 rounded-lg border border-line bg-surface p-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="rows-input" className="text-[13px] font-medium">
            Rows per table
          </label>
          <input
            id="rows-input"
            inputMode="numeric"
            aria-label="Rows per table"
            value={fmt(settings.rows)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9]/g, ""));
              if (Number.isFinite(n)) onChange({ rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, n)) });
            }}
            className="w-20 rounded border border-transparent bg-transparent px-1 text-right font-mono text-sm text-ink hover:border-line-strong focus:border-ink focus:outline-none"
          />
        </div>
        <Slider label="Rows per table" value={rowsToSlider(settings.rows)} onChange={(v) => onChange({ rows: sliderToRows(v) })} />
      </div>
      <div className="space-y-2">
        <label htmlFor="seed-input" className="block text-[13px] font-medium">
          Seed
        </label>
        <div className="flex items-center gap-1">
          <Input
            id="seed-input"
            inputMode="numeric"
            value={settings.seed}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9-]/g, ""));
              if (Number.isFinite(n)) onChange({ seed: Math.trunc(n) });
            }}
            className="font-mono"
          />
          <IconButton label="Pick a new random seed" onClick={reroll}>
            <Dices className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="space-y-2">
        <span className="block text-[13px] font-medium" id="null-label">
          Nullability
        </span>
        <div className="flex items-center gap-2" aria-labelledby="null-label">
          <Segmented<string>
            label="Nullability"
            value={custom ? "custom" : String(settings.nullRatio)}
            options={[...NULL_PRESETS.map((p) => ({ value: String(p), label: `${Math.round(p * 100)}%` })), { value: "custom", label: "Custom" }]}
            onChange={(v) => {
              if (v === "custom") setCustom(true);
              else {
                setCustom(false);
                onChange({ nullRatio: Number(v) });
              }
            }}
          />
          {custom ? (
            <div className="flex items-center gap-1">
              <Input
                aria-label="Custom null percentage"
                inputMode="decimal"
                className="w-16 font-mono"
                value={Math.round(settings.nullRatio * 1000) / 10}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onChange({ nullRatio: Math.min(1, Math.max(0, n / 100)) });
                }}
              />
              <span className="text-sm text-faint">%</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-2">
        <span className="block text-[13px] font-medium" id="format-label">
          Output
        </span>
        <Segmented<Format> label="Output format" value={settings.format} options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))} onChange={(f) => onChange({ format: f })} />
      </div>
    </div>
  );
}

export function StudioSettings(): ReactNode {
  const { settings, patchSettings } = useStudio();
  return <SettingsStrip settings={settings} onChange={patchSettings} />;
}
