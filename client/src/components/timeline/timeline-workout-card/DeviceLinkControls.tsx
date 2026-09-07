import type { TimelineEntry } from "@shared/schema";
import { ChevronDown } from "lucide-react";
import React from "react";

import { StravaIcon } from "@/components/icons/StravaIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type DeviceLinkTarget, useDeviceLinkMutations } from "@/hooks/useDeviceLinkMutations";

export interface DeviceLinkOption {
  /** The target's id, for React keys and test ids. */
  key: string;
  /** What the athlete reads: the target's focus ("Easy Run"). */
  label: string;
  target: DeviceLinkTarget;
}

export interface DeviceLinkOptions {
  /** The match the sync recorded on this import, when there is one. */
  suggestion: DeviceLinkOption | null;
  /** Every same-day row a recording could be linked to by hand. */
  candidates: DeviceLinkOption[];
}

/** A Strava import that is its own row: nothing is linked to it yet. */
export function isStandaloneStravaImport(entry: TimelineEntry): boolean {
  return (
    entry.type === "logged" &&
    entry.source === "strava" &&
    Boolean(entry.stravaActivityId) &&
    !entry.deviceLinkSource
  );
}

function isOpenPlannedSession(other: TimelineEntry): boolean {
  return (
    other.type === "planned" &&
    Boolean(other.planDayId) &&
    (other.status === "planned" || other.status === "missed")
  );
}

function isLinkableLog(other: TimelineEntry): boolean {
  return (
    other.type === "logged" &&
    Boolean(other.workoutLogId) &&
    !other.stravaActivityId &&
    other.source !== "strava" &&
    other.source !== "garmin"
  );
}

/**
 * Resolve, from the day's other entries, what this import could be linked
 * to. The suggestion's label comes from the sibling row when it is on screen
 * (it is, on the same date) and falls back to a generic noun otherwise, so a
 * stale suggestion still reads as a sentence.
 */
export function resolveDeviceLinkOptions(
  entry: TimelineEntry,
  dayEntries: readonly TimelineEntry[] = [],
): DeviceLinkOptions {
  const siblings = dayEntries.filter((other) => other.id !== entry.id && other.date === entry.date);
  const candidates: DeviceLinkOption[] = [];
  for (const other of siblings) {
    if (isOpenPlannedSession(other) && other.planDayId) {
      candidates.push({
        key: other.planDayId,
        label: other.focus,
        target: { planDayId: other.planDayId },
      });
    } else if (isLinkableLog(other) && other.workoutLogId) {
      candidates.push({
        key: other.workoutLogId,
        label: other.focus,
        target: { workoutLogId: other.workoutLogId },
      });
    }
  }

  let suggestion: DeviceLinkOption | null = null;
  if (entry.suggestedPlanDayId) {
    const id = entry.suggestedPlanDayId;
    const sibling = siblings.find((other) => other.planDayId === id);
    suggestion = {
      key: id,
      label: sibling?.focus ?? "that planned session",
      target: { planDayId: id },
    };
  } else if (entry.suggestedWorkoutLogId) {
    const id = entry.suggestedWorkoutLogId;
    const sibling = siblings.find((other) => other.workoutLogId === id);
    suggestion = {
      key: id,
      label: sibling?.focus ?? "that logged workout",
      target: { workoutLogId: id },
    };
  }
  return { suggestion, candidates };
}

interface DeviceLinkControlProps {
  readonly entry: TimelineEntry;
  readonly dayEntries?: readonly TimelineEntry[];
}

// Every control here sits inside the clickable card. Stopping click and key
// propagation keeps a tap on "Link" from also opening the workout detail.
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * "Was this your Easy Run?" — the sync found a plausible-but-uncertain match
 * for this standalone import. One tap links it; "Not this one" drops the
 * suggestion for good.
 */
export function DeviceLinkSuggestion({ entry, dayEntries }: Readonly<DeviceLinkControlProps>) {
  const { linkMutation, dismissMutation } = useDeviceLinkMutations();
  const workoutLogId = entry.workoutLogId;
  if (!workoutLogId || !isStandaloneStravaImport(entry)) return null;
  const { suggestion } = resolveDeviceLinkOptions(entry, dayEntries);
  if (!suggestion) return null;
  const busy = linkMutation.isPending || dismissMutation.isPending;

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#FC4C02]/30 bg-[#FC4C02]/5 px-2.5 py-1.5 text-xs"
      data-testid={`device-link-suggestion-${entry.id}`}
    >
      <StravaIcon className="h-3 w-3 shrink-0 text-[#FC4C02]" aria-hidden="true" />
      <span className="text-muted-foreground">
        Was this your <span className="font-medium text-foreground">{suggestion.label}</span>?
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          disabled={busy}
          onKeyDown={stop}
          onClick={(e) => {
            stop(e);
            linkMutation.mutate({
              workoutLogId,
              target: suggestion.target,
              targetLabel: suggestion.label,
            });
          }}
          data-testid={`device-link-accept-${entry.id}`}
        >
          Link
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-muted-foreground"
          disabled={busy}
          onKeyDown={stop}
          onClick={(e) => {
            stop(e);
            dismissMutation.mutate({ workoutLogId });
          }}
          data-testid={`device-link-dismiss-${entry.id}`}
        >
          Not this one
        </Button>
      </div>
    </div>
  );
}

const STRAVA_BADGE_CLASS = "bg-[#FC4C02]/10 text-[#FC4C02]";

/**
 * The Strava badge on a card. Static on a plain import; on a linked entry it
 * opens a menu with "Unlink Strava activity", and on a standalone import
 * with same-day rows it lists them to link to by hand. The activity's own
 * name heads the menu so the athlete knows which recording they are moving.
 */
export function StravaLinkBadge({ entry, dayEntries }: Readonly<DeviceLinkControlProps>) {
  const { linkMutation, unlinkMutation } = useDeviceLinkMutations();
  const workoutLogId = entry.workoutLogId;
  const isLinked = Boolean(entry.deviceLinkSource);
  const candidates = isStandaloneStravaImport(entry)
    ? resolveDeviceLinkOptions(entry, dayEntries).candidates
    : [];
  const hasMenu = Boolean(workoutLogId) && (isLinked || candidates.length > 0);

  if (!hasMenu || !workoutLogId) {
    return (
      <Badge
        className={STRAVA_BADGE_CLASS}
        title={entry.deviceActivityName ?? undefined}
        data-testid={`badge-strava-${entry.id}`}
      >
        <StravaIcon className="h-3 w-3 mr-1" aria-hidden="true" />
        Strava
      </Badge>
    );
  }

  const busy = linkMutation.isPending || unlinkMutation.isPending;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center whitespace-nowrap rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-[#FC4C02]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${STRAVA_BADGE_CLASS}`}
          aria-label={
            isLinked ? "Strava activity options" : "Link this Strava activity to a workout"
          }
          disabled={busy}
          onClick={stop}
          onMouseDown={stop}
          onKeyDown={stop}
          data-testid={`strava-badge-menu-${entry.id}`}
        >
          <StravaIcon className="h-3 w-3 mr-1" aria-hidden="true" />
          Strava
          <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={stop} onMouseDown={stop} onKeyDown={stop}>
        {entry.deviceActivityName && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {entry.deviceActivityName}
          </DropdownMenuLabel>
        )}
        {isLinked ? (
          <DropdownMenuItem
            onSelect={() => unlinkMutation.mutate({ workoutLogId })}
            data-testid={`device-unlink-${entry.id}`}
          >
            Unlink Strava activity
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuLabel>Link to a workout on this day</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {candidates.map((candidate) => (
              <DropdownMenuItem
                key={candidate.key}
                onSelect={() =>
                  linkMutation.mutate({
                    workoutLogId,
                    target: candidate.target,
                    targetLabel: candidate.label,
                  })
                }
                data-testid={`device-link-to-${entry.id}-${candidate.key}`}
              >
                {candidate.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
