import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMicros } from "@/hooks/useNutrition";

/**
 * Daily micronutrient totals against reference intakes (FR-5.1). Shows only the
 * micros the day's foods carry data for; most cached foods have none until
 * re-fetched, so a clear empty state explains the gap.
 */
export function MicronutrientPanel({ date }: { readonly date: string }) {
  const { data, isLoading } = useMicros(date);
  const micros = data?.micros ?? [];

  return (
    <Card data-testid="micro-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Micronutrients</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && micros.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : micros.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="micro-empty">
            No micronutrient data yet. Re-search a food to pull micros from USDA / Open Food Facts.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {micros.map((m) => (
              <div key={m.key} data-testid={`micro-${m.key}`}>
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
