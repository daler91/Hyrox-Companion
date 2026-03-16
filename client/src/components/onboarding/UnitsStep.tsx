import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface UnitsStepProps {
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onWeightUnitChange: (unit: "kg" | "lbs") => void;
  readonly onDistanceUnitChange: (unit: "km" | "miles") => void;
}

export function UnitsStep({ weightUnit, distanceUnit, onWeightUnitChange, onDistanceUnitChange }: UnitsStepProps) {
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
    </div>
  );
}
