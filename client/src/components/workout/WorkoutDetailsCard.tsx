import { RpeSelector } from "@/components/RpeSelector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { WorkoutDateFields } from "./WorkoutDateFields";

interface WorkoutDetailsCardProps {
  title: string;
  setTitle: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  rpe: number | null;
  setRpe: (value: number | null) => void;
}

export const WorkoutDetailsCard = ({
  title,
  setTitle,
  date,
  setDate,
  rpe,
  setRpe,
}: Readonly<WorkoutDetailsCardProps>) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <WorkoutDateFields
          title={title}
          setTitle={setTitle}
          date={date}
          setDate={setDate}
          gridClassName="grid grid-cols-2 gap-4"
        />
        <RpeSelector value={rpe} onChange={setRpe} />
      </CardContent>
    </Card>
  );
};
