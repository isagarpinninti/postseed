/** The rows slider is logarithmic: 1 to 10,000 across 0 to 100. */
export const MIN_ROWS = 1;
export const MAX_ROWS = 10_000;

export const rowsToSlider = (rows: number): number => {
  const r = Math.min(MAX_ROWS, Math.max(MIN_ROWS, rows));
  return Math.round((Math.log10(r) / Math.log10(MAX_ROWS)) * 100);
};

export const sliderToRows = (v: number): number => {
  const raw = 10 ** ((v / 100) * Math.log10(MAX_ROWS));
  if (raw < 20) return Math.max(1, Math.round(raw));
  if (raw < 200) return Math.round(raw / 5) * 5;
  if (raw < 2000) return Math.round(raw / 50) * 50;
  return Math.min(MAX_ROWS, Math.round(raw / 500) * 500);
};

export const fmt = (n: number): string => n.toLocaleString("en-US");

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
