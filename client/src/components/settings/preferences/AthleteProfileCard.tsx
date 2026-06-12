import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { PreferenceSelectRow } from "./PreferenceRows";

interface AthleteProfileCardProps {
  readonly division: string;
  readonly gender: string;
  /** Stringified age input ("" when unset); omit with onAgeChange to hide the row. */
  readonly age?: string;
  readonly onDivisionChange: (value: string) => void;
  readonly onGenderChange: (value: string) => void;
  readonly onAgeChange?: (value: string) => void;
}

export function AthleteProfileCard({
  division,
  gender,
  age,
  onDivisionChange,
  onGenderChange,
  onAgeChange,
}: Readonly<AthleteProfileCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Race profile</CardTitle>
        <CardDescription>
          Your HYROX division and gender set the station loads and benchmark times used by the Race
          Predictor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PreferenceSelectRow
          label="Division"
          description="Open uses lighter loads; Pro is the elite standard."
          value={division}
          onValueChange={onDivisionChange}
          options={[
            { value: "open", label: "Open" },
            { value: "pro", label: "Pro" },
          ]}
          testId="select-division"
          ariaLabel="Select division"
        />
        <PreferenceSelectRow
          label="Gender"
          description="Used for division-correct loads and benchmark times."
          value={gender}
          onValueChange={onGenderChange}
          options={[
            { value: "male", label: "Men" },
            { value: "female", label: "Women" },
            { value: "prefer_not_to_say", label: "Prefer not to say" },
          ]}
          testId="select-gender"
          ariaLabel="Select gender"
          triggerClassName="w-44"
        />
        {onAgeChange ? (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="athlete-age">Age</Label>
              <p id="athlete-age-desc" className="text-sm text-muted-foreground">
                Sets your Race Predictor age cohort for more accurate benchmark times.
              </p>
            </div>
            <Input
              id="athlete-age"
              type="number"
              inputMode="numeric"
              min={13}
              max={100}
              value={age ?? ""}
              onChange={(event) => onAgeChange(event.target.value)}
              className="w-24"
              data-testid="input-athlete-age"
              aria-label="Your age"
              aria-describedby="athlete-age-desc"
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
