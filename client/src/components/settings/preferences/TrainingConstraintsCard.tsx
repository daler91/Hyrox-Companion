import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CharacterCount } from "@/components/ui/character-count";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Same bound as `generatePlanInputSchema.injuries`, the field that seeds this. */
export const TRAINING_CONSTRAINTS_MAX_LENGTH = 500;

interface TrainingConstraintsCardProps {
  readonly trainingConstraints: string;
  readonly onTrainingConstraintsChange: (value: string) => void;
}

/**
 * The athlete's durable injuries and limitations, in their own words.
 *
 * Captured by the plan generator's wizard and remembered here, so the next
 * generation prefills instead of asking again. Editable and — importantly —
 * clearable: a constraint that has resolved must be forgettable without
 * generating a new plan to do it.
 */
export function TrainingConstraintsCard({
  trainingConstraints,
  onTrainingConstraintsChange,
}: TrainingConstraintsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Injuries &amp; Limitations</CardTitle>
        <CardDescription>
          Anything the coach should program around. Used when generating a plan; clear it once
          it no longer applies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="training-constraints" className="sr-only">
          Injuries and limitations
        </Label>
        <Textarea
          id="training-constraints"
          data-testid="input-training-constraints"
          placeholder="e.g. Recovering from a knee injury, avoid heavy squats. No sled at my gym."
          value={trainingConstraints}
          onChange={(event) => onTrainingConstraintsChange(event.target.value)}
          maxLength={TRAINING_CONSTRAINTS_MAX_LENGTH}
          rows={3}
          aria-describedby="training-constraints-count"
        />
        <CharacterCount
          id="training-constraints-count"
          value={trainingConstraints}
          max={TRAINING_CONSTRAINTS_MAX_LENGTH}
        />
      </CardContent>
    </Card>
  );
}
