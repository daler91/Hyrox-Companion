import { MicroRow } from "@/components/nutrition/MicroRow";
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

  const renderBody = () => {
    if (isLoading && micros.length === 0) {
      return <p className="text-xs text-muted-foreground">Loading…</p>;
    }
    if (micros.length === 0) {
      return (
        <p className="text-xs text-muted-foreground" data-testid="micro-empty">
          No micronutrient data yet. Re-search a food to pull micros from USDA / Open Food Facts.
        </p>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {micros.map((m) => (
          <MicroRow key={m.key} m={m} />
        ))}
      </div>
    );
  };

  return (
    <Card data-testid="micro-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Micronutrients</CardTitle>
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
    </Card>
  );
}
