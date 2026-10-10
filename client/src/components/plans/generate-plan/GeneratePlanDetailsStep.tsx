import type { AthleteFact } from "@shared/schema";
import { ChevronLeft, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { FOCUS_OPTIONS } from "./useGeneratePlanForm";

interface GeneratePlanDetailsStepProps {
  readonly focusAreas: string[];
  readonly onFocusToggle: (value: string) => void;
  /** The active facts on the athlete card: every plan is written around them already. */
  readonly cardFacts: readonly AthleteFact[];
  readonly injuries: string;
  readonly onInjuriesChange: (value: string) => void;
  readonly onBack: () => void;
  readonly onGenerate: () => void;
  readonly canGenerate: boolean;
  readonly isGenerating: boolean;
}

export function GeneratePlanDetailsStep({
  focusAreas,
  onFocusToggle,
  cardFacts,
  injuries,
  onInjuriesChange,
  onBack,
  onGenerate,
  canGenerate,
  isGenerating,
}: GeneratePlanDetailsStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Focus Areas (optional)</Label>
        <div className="flex flex-wrap gap-2">
          {FOCUS_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={focusAreas.includes(option.value) ? "default" : "outline"}
              size="sm"
              onClick={() => onFocusToggle(option.value)}
              aria-pressed={focusAreas.includes(option.value)}
              type="button"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {cardFacts.length > 0 && (
        <section aria-labelledby="card-facts-heading" className="space-y-1.5 rounded-md border bg-muted/40 p-3">
          <h3 id="card-facts-heading" className="text-sm font-medium">
            Your coach already knows
          </h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {cardFacts.map((fact) => (
              <li key={fact.id}>{fact.fact}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Every plan is written around these. Change them in Settings, under Athlete card.
          </p>
        </section>
      )}

      <div className="space-y-2">
        <Label htmlFor="injuries">
          {cardFacts.length > 0
            ? "Anything else to program around? (optional)"
            : "Injuries or Limitations (optional)"}
        </Label>
        <Textarea
          id="injuries"
          placeholder="e.g., Recovering from knee injury, avoid heavy squats"
          value={injuries}
          onChange={(event) => onInjuriesChange(event.target.value)}
          maxLength={500}
          rows={2}
          aria-describedby="injuries-hint injuries-count"
        />
        <p id="injuries-hint" className="text-xs text-muted-foreground">
          Each sentence is saved to your athlete card, so your coach remembers it.
        </p>
        <CharacterCount id="injuries-count" value={injuries} max={500} />
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Back
        </Button>
        <Button onClick={onGenerate} disabled={!canGenerate || isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              Generate Plan
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
