import type { AthleteFact } from "@shared/schema";
import { ChevronDown, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
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
  // U15 (CODEBASE_ANALYSIS_2026-10-03): 'Delete forever' sits next to
  // 'Restore' and deleted on one tap; it now asks first, like every other
  // irreversible action in Settings.
  const [pendingDelete, setPendingDelete] = useState<AthleteFact | null>(null);
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
            <RetiredFactRow
              key={fact.id}
              fact={fact}
              restoreDisabled={atCap || update.isPending}
              onRestore={() => {
                update.mutate({ id: fact.id, changes: { active: true } });
              }}
              deleteDisabled={remove.isPending}
              onRequestDelete={() => {
                setPendingDelete(fact);
              }}
            />
          ))}
        </ul>
      </CollapsibleContent>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete forever?"
        description={
          pendingDelete
            ? `"${pendingDelete.fact}" will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmText="Delete forever"
        isDestructive
        isPending={remove.isPending}
        cancelTestId="cancel-delete-retired-fact"
        confirmTestId="confirm-delete-retired-fact"
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, {
            onSettled: () => {
              setPendingDelete(null);
            },
          });
        }}
      />
    </Collapsible>
  );
}

interface RetiredFactRowProps {
  readonly fact: AthleteFact;
  readonly restoreDisabled: boolean;
  readonly onRestore: () => void;
  readonly deleteDisabled: boolean;
  readonly onRequestDelete: () => void;
}

function RetiredFactRow({
  fact,
  restoreDisabled,
  onRestore,
  deleteDisabled,
  onRequestDelete,
}: RetiredFactRowProps) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 break-words text-sm text-muted-foreground">{fact.fact}</span>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Restore "${fact.fact}"`}
          onClick={onRestore}
          disabled={restoreDisabled}
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
                onClick={onRequestDelete}
                disabled={deleteDisabled}
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
  );
}
