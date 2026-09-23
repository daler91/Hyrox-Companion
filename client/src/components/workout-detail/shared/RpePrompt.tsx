import { Gauge } from "lucide-react";

import { RpeSelector } from "@/components/RpeSelector";

interface RpePromptProps {
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
  /**
   * The RPE a recording's heart rate suggests (review surface only). Marked in
   * the picker while nothing is chosen; it is saved only if the athlete taps
   * it, like any other value.
   */
  readonly suggestedValue?: number | null;
}

/**
 * Optional-RPE picker. Owns the "How hard? (optional)" label above the
 * compact RpeSelector so every workout surface stays visually identical.
 * Rendered through WorkoutEffortNotes, which pairs it with the note
 * field on the log, ad-hoc, and review surfaces alike.
 */
export function RpePrompt({ value, onChange, suggestedValue = null }: RpePromptProps) {
  const showSuggestion = value === null && suggestedValue !== null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        How hard? <span className="normal-case text-muted-foreground">(optional)</span>
      </p>
      <RpeSelector
        value={value}
        onChange={onChange}
        showLabel={false}
        compact
        suggestedValue={suggestedValue}
      />
      {showSuggestion && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="text-rpe-suggestion">
          Your heart rate suggests {suggestedValue}. Tap it to save, or pick your own.
        </p>
      )}
    </div>
  );
}
