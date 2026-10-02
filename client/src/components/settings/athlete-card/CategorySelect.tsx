import type { AthleteFactCategory } from "@shared/schema/enums";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ATHLETE_FACT_CATEGORY_OPTIONS } from "./athleteCardModel";

interface CategorySelectProps {
  readonly id: string;
  readonly value: AthleteFactCategory;
  readonly onValueChange: (value: AthleteFactCategory) => void;
}

/** What a fact is about. The coach reads the category with the fact. */
export function CategorySelect({ id, value, onValueChange }: CategorySelectProps) {
  const choose = (next: string) => {
    const option = ATHLETE_FACT_CATEGORY_OPTIONS.find((candidate) => candidate.value === next);
    if (option) onValueChange(option.value);
  };
  return (
    <Select value={value} onValueChange={choose}>
      <SelectTrigger id={id} className="w-40" aria-label="What it's about" data-testid={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ATHLETE_FACT_CATEGORY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
