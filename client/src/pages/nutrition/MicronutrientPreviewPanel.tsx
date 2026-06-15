import type { MicroSummaryRow } from "@shared/schema";

import { MicroRow } from "@/components/nutrition/MicroRow";

/** Which curated micros are minerals; the rest are vitamins (presentation only). */
const MINERAL_KEYS = new Set(["sodium", "potassium", "calcium", "iron", "magnesium", "zinc"]);

function MicroGroup({ title, rows }: { readonly title: string; readonly rows: MicroSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map((m) => (
          <MicroRow key={m.key} m={m} testIdPrefix="preview-micro-" />
        ))}
      </div>
    </div>
  );
}

/**
 * Per-serving vitamins & minerals with %RDI bars (≥100% turns green), grouped
 * Minerals / Vitamins. Shows only the micros the food carries data for
 * (absent ≠ zero) — most non-USDA foods have none, so once loaded with no data
 * it shows a short explanation rather than a blank tab.
 */
export function MicronutrientPreviewPanel({
  rows,
  isLoading = false,
}: {
  readonly rows: MicroSummaryRow[];
  readonly isLoading?: boolean;
}) {
  if (rows.length === 0) {
    if (isLoading) {
      return <p className="text-xs text-muted-foreground">Loading micronutrients…</p>;
    }
    return (
      <p className="text-xs text-muted-foreground" data-testid="preview-micro-empty">
        No micronutrient data for this food yet.
      </p>
    );
  }

  const minerals = rows.filter((m) => MINERAL_KEYS.has(m.key));
  const vitamins = rows.filter((m) => !MINERAL_KEYS.has(m.key));

  return (
    <div className="space-y-4" data-testid="preview-micro-panel">
      <MicroGroup title="Minerals" rows={minerals} />
      <MicroGroup title="Vitamins" rows={vitamins} />
    </div>
  );
}
