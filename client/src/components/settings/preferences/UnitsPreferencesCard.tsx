import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSelectRow } from "./PreferenceRows";

interface UnitsPreferencesCardProps {
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly onWeightUnitChange: (value: string) => void;
  readonly onDistanceUnitChange: (value: string) => void;
}

export function UnitsPreferencesCard({
  weightUnit,
  distanceUnit,
  onWeightUnitChange,
  onDistanceUnitChange,
}: UnitsPreferencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Units</CardTitle>
        <CardDescription>Choose your preferred measurement units</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSelectRow
          label="Weight Unit"
          description="For sled weights, wall balls, etc."
          value={weightUnit}
          onValueChange={onWeightUnitChange}
          options={[
            { value: "kg", label: "kg" },
            { value: "lbs", label: "lbs" },
          ]}
          testId="select-weight-unit"
          ariaLabel="Select weight unit"
        />
        <PreferenceSelectRow
          label="Distance Unit"
          description="For running, rowing, etc."
          value={distanceUnit}
          onValueChange={onDistanceUnitChange}
          options={[
            { value: "km", label: "km" },
            { value: "miles", label: "miles" },
          ]}
          testId="select-distance-unit"
          ariaLabel="Select distance unit"
        />
      </CardContent>
    </Card>
  );
}
