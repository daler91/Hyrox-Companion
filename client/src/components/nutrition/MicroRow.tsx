import type { MicroSummaryRow } from "@shared/schema";

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
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${m.pctRdi >= 100 ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${Math.min(m.pctRdi, 100)}%` }}
        />
      </div>
      <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
        {m.amount} / {m.rdi} {m.unit}
      </span>
    </div>
  );
}
