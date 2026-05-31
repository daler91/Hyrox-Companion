import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Division = "open" | "pro";
type Gender = "male" | "female" | "prefer_not_to_say";

interface UnitsStepProps {
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly division: Division;
  readonly gender: Gender;
  readonly onWeightUnitChange: (unit: "kg" | "lbs") => void;
  readonly onDistanceUnitChange: (unit: "km" | "miles") => void;
  readonly onDivisionChange: (division: Division) => void;
  readonly onGenderChange: (gender: Gender) => void;
}

export function UnitsStep({
  weightUnit,
  distanceUnit,
  division,
  gender,
  onWeightUnitChange,
  onDistanceUnitChange,
  onDivisionChange,
  onGenderChange,
}: Readonly<UnitsStepProps>) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className="text-base">Weight</Label>
        <RadioGroup
          value={weightUnit}
          onValueChange={(v) => onWeightUnitChange(v as "kg" | "lbs")}
          className="flex gap-4"
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
        <Label className="text-base">Distance</Label>
        <RadioGroup
          value={distanceUnit}
          onValueChange={(v) => onDistanceUnitChange(v as "km" | "miles")}
          className="flex gap-4"
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
        <Label className="text-base">Division</Label>
        <p className="text-sm text-muted-foreground">Sets the station loads used to predict your race finish.</p>
        <RadioGroup
          value={division}
          onValueChange={(v) => onDivisionChange(v as Division)}
          className="flex gap-4"
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
        <Label className="text-base">Gender</Label>
        <p className="text-sm text-muted-foreground">Used for division-correct loads and benchmark times.</p>
        <RadioGroup
          value={gender}
          onValueChange={(v) => onGenderChange(v as Gender)}
          className="flex flex-wrap gap-4"
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
    </div>
  );
}
