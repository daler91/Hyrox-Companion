/**
 * A thin macro progress bar: fills to `pct` (capped at 100% width), turning
 * amber once the target is exceeded. Shared by the daily totals header and the
 * per-meal fuel targets so the two read identically.
 */
export function MacroProgressBar({ pct }: { readonly pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full ${pct > 100 ? "bg-amber-500" : "bg-primary"}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}
