import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Division = "open" | "pro";
type Gender = "male" | "female" | "prefer_not_to_say";

interface UnitsStepProps {
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly division: Division;
  readonly gender: Gender;
  readonly age: string;
  /** Why the typed age can't be saved, shown under the field. */
  readonly ageError?: string | null;
  readonly onWeightUnitChange: (unit: "kg" | "lbs") => void;
  readonly onDistanceUnitChange: (unit: "km" | "miles") => void;
  readonly onDivisionChange: (division: Division) => void;
  readonly onGenderChange: (gender: Gender) => void;
  readonly onAgeChange: (age: string) => void;
}

// Each group is named by its visible label (aria-labelledby). They were
// announced as bare, unnamed radio groups (onboarding audit M4).
export function UnitsStep({
  weightUnit,
  distanceUnit,
  division,
  gender,
  age,
  ageError,
  onWeightUnitChange,
  onDistanceUnitChange,
  onDivisionChange,
  onGenderChange,
  onAgeChange,
}: Readonly<UnitsStepProps>) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label id="units-weight-label" className="text-base">Weight</Label>
        <RadioGroup
          value={weightUnit}
          onValueChange={(v) => onWeightUnitChange(v as "kg" | "lbs")}
          className="flex flex-wrap gap-4"
          aria-labelledby="units-weight-label"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="kg" id="kg" />
            <Label htmlFor="kg" className="cursor-pointer">Kilograms (kg)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="lbs" id="lbs" />
            <Label htmlFor="lbs" className="cursor-pointer">Pounds (lbs)</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-3">
        <Label id="units-distance-label" className="text-base">Distance</Label>
        <RadioGroup
          value={distanceUnit}
          onValueChange={(v) => onDistanceUnitChange(v as "km" | "miles")}
          className="flex flex-wrap gap-4"
          aria-labelledby="units-distance-label"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="km" id="km" />
            <Label htmlFor="km" className="cursor-pointer">Kilometers (km)</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="miles" id="miles" />
            <Label htmlFor="miles" className="cursor-pointer">Miles</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-3">
        <Label id="units-division-label" className="text-base">Division</Label>
        <p id="units-division-hint" className="text-sm text-muted-foreground">
          Sets the station loads used to predict your race finish.
        </p>
        <RadioGroup
          value={division}
          onValueChange={(v) => onDivisionChange(v as Division)}
          className="flex flex-wrap gap-4"
          aria-labelledby="units-division-label"
          aria-describedby="units-division-hint"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="open" id="division-open" />
            <Label htmlFor="division-open" className="cursor-pointer">Open</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="pro" id="division-pro" />
            <Label htmlFor="division-pro" className="cursor-pointer">Pro</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-3">
        <Label id="units-gender-label" className="text-base">Gender</Label>
        <p id="units-gender-hint" className="text-sm text-muted-foreground">
          Used for division-correct loads and benchmark times.
        </p>
        <RadioGroup
          value={gender}
          onValueChange={(v) => onGenderChange(v as Gender)}
          className="flex flex-wrap gap-4"
          aria-labelledby="units-gender-label"
          aria-describedby="units-gender-hint"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="male" id="gender-male" />
            <Label htmlFor="gender-male" className="cursor-pointer">Men</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="female" id="gender-female" />
            <Label htmlFor="gender-female" className="cursor-pointer">Women</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="prefer_not_to_say" id="gender-prefer-not" />
            <Label htmlFor="gender-prefer-not" className="cursor-pointer">Prefer not to say</Label>
          </div>
        </RadioGroup>
      </div>

      {/* Age feeds the Race Predictor's age group and, with no max HR set, the
          heart-rate model, which withholds HR-based load without it. It was
          only saved through the optional fuelling step (onboarding audit M3). */}
      <div className="space-y-2">
        <Label htmlFor="onboarding-age" className="text-base">
          Age <span className="text-sm font-normal text-muted-foreground">(optional)</span>
        </Label>
        <p id="onboarding-age-hint" className="text-sm text-muted-foreground">
          Picks your age group for race predictions and estimates your max heart rate.
        </p>
        <Input
          id="onboarding-age"
          type="number"
          inputMode="numeric"
          min={13}
          max={100}
          className="w-24"
          value={age}
          onChange={(e) => onAgeChange(e.target.value)}
          aria-invalid={ageError ? true : undefined}
          aria-describedby={ageError ? "onboarding-age-hint onboarding-age-error" : "onboarding-age-hint"}
          data-testid="input-onboarding-age"
        />
        {ageError && (
          <p id="onboarding-age-error" className="text-sm text-destructive">
            {ageError}
          </p>
        )}
      </div>
    </div>
  );
}
