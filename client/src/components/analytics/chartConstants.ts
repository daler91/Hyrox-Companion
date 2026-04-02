export const MUTED_FG = "hsl(var(--muted-foreground))";
export const GRID_BORDER = "hsl(var(--border))";
export const GRID_DASH = "3 3";
export const MUTED_CURSOR = "hsl(var(--muted)/0.5)";
export const COLOR_GREEN = "#22c55e";
export const COLOR_PRIMARY = "#ea580c";
export const CHART_CARD_CLASS = "space-y-3 p-4 border rounded-lg bg-card text-card-foreground shadow-sm";

export function formatChartDate(d: string): string {
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
