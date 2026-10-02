import type { AthleteFact } from "@shared/schema";
import { ChevronDown, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteAthleteFact, useUpdateAthleteFact } from "@/hooks/useAthleteFacts";

interface RetiredFactListProps {
  readonly facts: readonly AthleteFact[];
  /** The card is full, so nothing can be restored until a fact is retired. */
  readonly atCap: boolean;
}

/**
 * Facts the athlete said no longer apply. They stay listed (and stored) so
 * the plan wizard's older note can't bring one back, until deleted here.
 */
export function RetiredFactList({ facts, atCap }: RetiredFactListProps) {
  const update = useUpdateAthleteFact();
  const remove = useDeleteAthleteFact();
  if (facts.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group -ml-2">
          Retired ({facts.length})
          <ChevronDown
            className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">
        <p className="text-xs text-muted-foreground">
          Your coach no longer reads these. Restore one if it applies again.
        </p>
        <ul className="divide-y">
          {facts.map((fact) => (
            <li key={fact.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 break-words text-sm text-muted-foreground">{fact.fact}</span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Restore "${fact.fact}"`}
                  onClick={() => {
                    update.mutate({ id: fact.id, changes: { active: true } });
                  }}
                  disabled={atCap || update.isPending}
                >
                  Restore
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete "${fact.fact}"`}
                        onClick={() => {
                          remove.mutate(fact.id);
                        }}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Delete forever</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
