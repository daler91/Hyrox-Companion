import { ATHLETE_FACT_MAX_LENGTH } from "@shared/athleteFacts";
import type { AthleteFact, UpdateAthleteFact } from "@shared/schema";
import { Archive, Pencil } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdateAthleteFact } from "@/hooks/useAthleteFacts";

import { athleteFactCategoryLabel } from "./athleteCardModel";
import { CategorySelect } from "./CategorySelect";

interface AthleteFactEditorProps {
  readonly fact: AthleteFact;
  readonly onDone: () => void;
}

function AthleteFactEditor({ fact, onDone }: AthleteFactEditorProps) {
  const [text, setText] = useState(fact.fact);
  const [category, setCategory] = useState(fact.category);
  const update = useUpdateAthleteFact();
  const trimmed = text.trim();
  const inputId = `edit-athlete-fact-${fact.id}`;
  // Focus the wording when the form opens, as an inline edit should; done
  // here rather than with autoFocus, which also fires on every remount.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const save = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const changes: UpdateAthleteFact = {
      ...(trimmed === fact.fact ? {} : { fact: trimmed }),
      ...(category === fact.category ? {} : { category }),
    };
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    update.mutate({ id: fact.id, changes }, { onSuccess: onDone });
  };

  return (
    <li className="rounded-md border p-3">
      <form className="space-y-2" onSubmit={save}>
        <Label htmlFor={inputId} className="sr-only">
          Fact
        </Label>
        <Input
          id={inputId}
          value={text}
          ref={inputRef}
          onChange={(event) => {
            setText(event.target.value);
          }}
          maxLength={ATHLETE_FACT_MAX_LENGTH}
        />
        <div className="flex flex-wrap items-center gap-2">
          <CategorySelect id={`${inputId}-category`} value={category} onValueChange={setCategory} />
          <Button type="submit" size="sm" disabled={!trimmed || update.isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}

interface AthleteFactRowProps {
  readonly fact: AthleteFact;
  /** Past its review date: the athlete is asked whether it still holds. */
  readonly due: boolean;
}

/** One fact the coach reads, with its "Still true?" check once it is due. */
export function AthleteFactRow({ fact, due }: AthleteFactRowProps) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateAthleteFact();
  const retire = () => {
    update.mutate({ id: fact.id, changes: { active: false } });
  };

  if (editing) {
    return (
      <AthleteFactEditor
        fact={fact}
        onDone={() => {
          setEditing(false);
        }}
      />
    );
  }

  return (
    <li className="space-y-2 rounded-md border p-3" data-testid={`athlete-fact-${fact.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm">{fact.fact}</p>
          <Badge variant="secondary">{athleteFactCategoryLabel(fact.category)}</Badge>
        </div>
        <TooltipProvider>
          <div className="flex shrink-0 gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit "${fact.fact}"`}
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Retire "${fact.fact}"`}
                  onClick={retire}
                  disabled={update.isPending}
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Retire</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      {due ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-sm">
          <span className="font-medium">Still true?</span>
          <span className="text-muted-foreground">You haven&apos;t confirmed this in a while.</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                update.mutate({ id: fact.id, changes: { confirm: true } });
              }}
              disabled={update.isPending}
            >
              Yes, still true
            </Button>
            <Button size="sm" variant="ghost" onClick={retire} disabled={update.isPending}>
              No, retire it
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
