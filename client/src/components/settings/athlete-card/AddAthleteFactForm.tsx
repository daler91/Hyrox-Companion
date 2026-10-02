import { ATHLETE_FACT_MAX_LENGTH, MAX_ACTIVE_ATHLETE_FACTS } from "@shared/athleteFacts";
import type { AthleteFactCategory } from "@shared/schema/enums";
import { Plus } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddAthleteFact } from "@/hooks/useAthleteFacts";

import { CategorySelect } from "./CategorySelect";

interface AddAthleteFactFormProps {
  /** The card already holds as many active facts as it can. */
  readonly atCap: boolean;
}

export function AddAthleteFactForm({ atCap }: AddAthleteFactFormProps) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState<AthleteFactCategory>("constraint");
  const add = useAddAthleteFact();
  const trimmed = text.trim();

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || atCap) return;
    add.mutate(
      { fact: trimmed, category },
      {
        onSuccess: () => {
          setText("");
        },
      },
    );
  };

  return (
    <form className="space-y-2" onSubmit={submit}>
      <Label htmlFor="new-athlete-fact">Add a fact</Label>
      <Input
        id="new-athlete-fact"
        data-testid="input-new-athlete-fact"
        placeholder="e.g. Bad left knee: no deep lunges"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        maxLength={ATHLETE_FACT_MAX_LENGTH}
        disabled={atCap}
        aria-describedby="new-athlete-fact-hint new-athlete-fact-count"
      />
      <p id="new-athlete-fact-hint" className="text-xs text-muted-foreground">
        {atCap
          ? `Your card holds up to ${MAX_ACTIVE_ATHLETE_FACTS} facts. Retire one that no longer applies to add another.`
          : "One thing per fact, in your own words. It stays on your card until you retire it."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <CategorySelect id="new-athlete-fact-category" value={category} onValueChange={setCategory} />
        <Button type="submit" size="sm" disabled={!trimmed || atCap || add.isPending}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add
        </Button>
        <CharacterCount
          id="new-athlete-fact-count"
          value={text}
          max={ATHLETE_FACT_MAX_LENGTH}
          className="ml-auto"
        />
      </div>
    </form>
  );
}
