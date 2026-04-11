import { format, subDays } from "date-fns";
import React from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WorkoutDetailsCardProps {
  title: string;
  setTitle: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  rpe: number | null;
  setRpe: (value: number | null) => void;
}

function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function yesterdayIso(): string {
  return format(subDays(new Date(), 1), "yyyy-MM-dd");
}

export const WorkoutDetailsCard = ({
  title,
  setTitle,
  date,
  setDate,
  rpe,
  setRpe,
}: Readonly<WorkoutDetailsCardProps>) => {
  const today = todayIso();
  const yesterday = yesterdayIso();
  const isToday = date === today;
  const isYesterday = date === yesterday;

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
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Quick-pick workout date"
        >
          <Button
            type="button"
            variant={isToday ? "default" : "outline"}
            size="sm"
            onClick={() => setDate(today)}
            data-testid="button-date-today"
          >
            Today
          </Button>
          <Button
            type="button"
            variant={isYesterday ? "default" : "outline"}
            size="sm"
            onClick={() => setDate(yesterday)}
            data-testid="button-date-yesterday"
          >
            Yesterday
          </Button>
          <span className="text-xs text-muted-foreground self-center ml-1">
            Or use the date picker above for earlier workouts
          </span>
        </div>
        <RpeSelector value={rpe} onChange={setRpe} />
      </CardContent>
    </Card>
  );
};
