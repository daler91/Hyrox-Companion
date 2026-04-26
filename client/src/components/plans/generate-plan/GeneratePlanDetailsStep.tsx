import { ChevronLeft, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { FOCUS_OPTIONS } from "./useGeneratePlanForm";

interface GeneratePlanDetailsStepProps {
  readonly focusAreas: string[];
  readonly onFocusToggle: (value: string) => void;
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
              type="button"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="injuries">Injuries or Limitations (optional)</Label>
        <Textarea
          id="injuries"
          placeholder="e.g., Recovering from knee injury, avoid heavy squats"
          value={injuries}
          onChange={(event) => onInjuriesChange(event.target.value)}
          maxLength={500}
          rows={2}
          aria-describedby="injuries-count"
        />
        <CharacterCount id="injuries-count" value={injuries} max={500} />
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button onClick={onGenerate} disabled={!canGenerate || isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Plan
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
