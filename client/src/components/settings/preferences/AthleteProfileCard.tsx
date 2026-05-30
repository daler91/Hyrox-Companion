import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { PreferenceSelectRow } from "./PreferenceRows";

interface AthleteProfileCardProps {
  readonly division: string;
  readonly gender: string;
  readonly onDivisionChange: (value: string) => void;
  readonly onGenderChange: (value: string) => void;
}

export function AthleteProfileCard({
  division,
  gender,
  onDivisionChange,
  onGenderChange,
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
      </CardContent>
    </Card>
  );
}
