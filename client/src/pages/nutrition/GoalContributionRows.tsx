import type { GoalContributionRow } from "./utils";

/**
 * "Effect on today's goals": for each macro the user set a target for, shows how
 * this serving moves the day from its current % to the projected %, with a
 * two-tone bar (current fill + the serving's added segment). The added segment
 * turns amber when the serving pushes the day over the goal. Renders nothing when
 * no targets are set.
 */
export function GoalContributionRows({
  rows,
}: {
  readonly rows: readonly GoalContributionRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="goal-contrib">
      <p className="text-xs font-semibold text-muted-foreground">Effect on today&apos;s goals</p>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const basePct = Math.min(Math.max(r.currentPct, 0), 100);
          const projPct = Math.min(Math.max(r.projectedPct, 0), 100);
          const addedPct = Math.max(projPct - basePct, 0);
          const over = r.projectedPct > 100;
          return (
            <div key={r.key} className="space-y-1" data-testid={`goal-contrib-${r.key}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="text-xs tabular-nums">
                  <span className="text-muted-foreground">{r.currentPct}%</span>
                  <span className="mx-1" aria-label="to">
                    →
                  </span>
                  <span
                    className={`font-medium ${over ? "text-amber-600 dark:text-amber-500" : ""}`}
                  >
                    {r.projectedPct}%
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {r.projected} / {r.target}
                  </span>
                </span>
              </div>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${basePct}%` }} />
                <div
                  className={`h-full ${over ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${addedPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
