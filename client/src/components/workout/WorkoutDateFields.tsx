import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTodayString, getYesterdayString } from "@/lib/dateUtils";

interface WorkoutDateFieldsProps {
  readonly title: string;
  readonly setTitle: (value: string) => void;
  readonly date: string;
  readonly setDate: (value: string) => void;
  readonly gridClassName?: string;
}

export function WorkoutDateFields({
  title,
  setTitle,
  date,
  setDate,
  gridClassName = "grid grid-cols-1 sm:grid-cols-2 gap-4",
}: WorkoutDateFieldsProps) {
  const today = getTodayString();
  const yesterday = getYesterdayString();

  return (
    <div className="space-y-4">
      <div className={gridClassName}>
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
      <fieldset className="flex flex-wrap gap-2 border-0 p-0 m-0">
        <legend className="sr-only">Quick-pick workout date</legend>
        <Button
          type="button"
          variant={date === today ? "default" : "outline"}
          size="sm"
          onClick={() => setDate(today)}
          data-testid="button-date-today"
        >
          Today
        </Button>
        <Button
          type="button"
          variant={date === yesterday ? "default" : "outline"}
          size="sm"
          onClick={() => setDate(yesterday)}
          data-testid="button-date-yesterday"
        >
          Yesterday
        </Button>
      </fieldset>
    </div>
  );
}
