import type { MicroSummaryRow } from "@shared/schema";

import { cn } from "@/lib/utils";

/**
 * One micronutrient row: label, %RDI, a progress bar (≥100% turns green), and the
 * amount / RDI line. Shared by the daily MicronutrientPanel and the per-serving
 * MicronutrientPreviewPanel; `testIdPrefix` keeps each panel's existing
 * data-testid intact ("micro-" vs "preview-micro-").
 */
export function MicroRow({
  m,
  testIdPrefix = "micro-",
}: {
  readonly m: MicroSummaryRow;
  readonly testIdPrefix?: string;
}) {
  return (
    <div data-testid={`${testIdPrefix}${m.key}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{m.label}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{m.pctRdi}%</span>
      </div>
      <progress
        className={cn(
          "mt-0.5 block h-1 w-full appearance-none overflow-hidden rounded-full bg-muted",
          "[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full",
          m.pctRdi >= 100
            ? "[&::-webkit-progress-value]:bg-emerald-500 [&::-moz-progress-bar]:bg-emerald-500"
            : "[&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary",
        )}
        value={Math.min(m.pctRdi, 100)}
        max={100}
        aria-label={m.label}
        aria-valuetext={`${m.amount} of ${m.rdi} ${m.unit}, ${m.pctRdi}% of daily intake`}
      />
      <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
        {m.amount} / {m.rdi} {m.unit}
      </span>
    </div>
  );
}
