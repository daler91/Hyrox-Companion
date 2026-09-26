import type { MissedRecoveryAction, MissedRecoveryOption, TimelineEntry } from "@shared/schema";
import { CalendarPlus, Feather, Scissors } from "lucide-react";
import type React from "react";

import { Button } from "@/components/ui/button";

/** Open the recovery sheet on an option, or (for `reopen`) take a let-go back at once. */
export type RecoverEntryHandler = (entry: TimelineEntry, action: MissedRecoveryAction) => void;

/**
 * A missed session the timeline should ask about. The server decides
 * (`recoverable`, in the athlete's own timezone): undecided, a real session,
 * not a race-week day, and recent enough to move. Older misses just read as
 * missed.
 */
export function isRecoverableEntry(entry: TimelineEntry): boolean {
  return (
    entry.status === "missed" &&
    entry.recoverable === true &&
    Boolean(entry.planDayId) &&
    entry.recovery !== "let_go"
  );
}

function promptCopy(entry: TimelineEntry): string {
  if (entry.recovery === "folded" || entry.recovery === "shortened") {
    return "Missed again after it was moved. What now?";
  }
  switch (entry.priority) {
    case "key":
      return "A key session — worth fitting back in.";
    case "optional":
      return "An optional session — fine to let this one go.";
    default:
      return "Fit it back in, or let it go?";
  }
}

interface PromptAction {
  readonly action: MissedRecoveryOption;
  readonly label: string;
  readonly icon: typeof CalendarPlus;
}

const FOLD: PromptAction = { action: "fold", label: "Fold into another day", icon: CalendarPlus };
const SHORTEN: PromptAction = { action: "shorten", label: "Shorten it", icon: Scissors };
const LET_GO: PromptAction = { action: "let_go", label: "Let it go", icon: Feather };

/** The buttons, likeliest first: an optional session leads with letting it go. */
function promptActions(entry: TimelineEntry): readonly PromptAction[] {
  if (entry.priority === "optional") return [LET_GO, FOLD, SHORTEN];
  return [FOLD, SHORTEN, LET_GO];
}

/** Outlined: the lead action, and both ways back in for a session that matters. */
function isEmphasised(entry: TimelineEntry, action: MissedRecoveryOption, index: number): boolean {
  return index === 0 || (entry.priority !== "optional" && action !== "let_go");
}

// The card is itself a button that opens the log sheet: every control in here
// stops its click (and the Enter/Space that would re-trigger the card) from
// reaching it.
function stopKeys(event: React.KeyboardEvent) {
  event.stopPropagation();
}

interface MissedRecoveryPromptProps {
  readonly entry: TimelineEntry;
  readonly onRecover?: RecoverEntryHandler;
}

/**
 * Where the red "Missed" square used to end: the three ways forward, right on
 * the card. Each opens the recovery sheet on that option, with what it does to
 * the plan. Once let go, the card says so quietly and offers the undo.
 */
export function MissedRecoveryPrompt({ entry, onRecover }: MissedRecoveryPromptProps) {
  if (!onRecover || !entry.planDayId) return null;

  if (entry.status === "missed" && entry.recovery === "let_go") {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid={`missed-let-go-${entry.id}`}>
        You let this one go.
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-0 px-1 py-0 text-xs underline underline-offset-2"
          onClick={(event) => {
            event.stopPropagation();
            onRecover(entry, "reopen");
          }}
          onKeyDown={stopKeys}
          data-testid={`missed-let-go-undo-${entry.id}`}
        >
          Undo
        </Button>
      </p>
    );
  }

  if (!isRecoverableEntry(entry)) return null;

  return (
    <div
      className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3"
      data-testid={`missed-recovery-prompt-${entry.id}`}
    >
      <p className="text-sm text-foreground">{promptCopy(entry)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {promptActions(entry).map(({ action, label, icon: Icon }, index) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={isEmphasised(entry, action, index) ? "outline" : "ghost"}
            className="min-h-9"
            onClick={(event) => {
              event.stopPropagation();
              onRecover(entry, action);
            }}
            onKeyDown={stopKeys}
            data-testid={`missed-recovery-${action}-${entry.id}`}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
