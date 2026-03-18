import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RpeSelector } from "@/components/RpeSelector";

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
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title (Optional)</Label>
            <Input
              id="title"
              placeholder="e.g., Morning Push"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-workout-title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="input-workout-date"
            />
          </div>
        </div>
        <RpeSelector value={rpe} onChange={setRpe} />
      </CardContent>
    </Card>
  );
};
