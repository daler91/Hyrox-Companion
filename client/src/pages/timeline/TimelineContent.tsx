import type { TimelineAnnotation, TimelineEntry } from "@shared/schema";
import type { Virtualizer } from "@tanstack/react-virtual";
import { format, isToday, parseISO } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ChangeEvent } from "react";

import {
  TimelineDateGroup,
  TimelineEmptyState,
  TimelineSkeleton,
} from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { useTimelineState } from "@/hooks/useTimelineState";

type TimelineState = ReturnType<typeof useTimelineState>;
type TimelineData = TimelineState["data"];
type TimelineFiltersState = TimelineState["filters"];
type PlanImportState = TimelineState["planImport"];

interface TimelineContentProps {
  timelineLoading: TimelineData["timelineLoading"];
  filterStatus: TimelineFiltersState["filterStatus"];
  selectedPlanId: TimelineState["selectedPlanId"];
  plans: TimelineData["plans"];
  samplePlanMutation: PlanImportState["samplePlanMutation"];
  importMutation: PlanImportState["importMutation"];
  handleFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  setSchedulingPlanId: PlanImportState["setSchedulingPlanId"];
  setFilterStatus: TimelineFiltersState["setFilterStatus"];
  hiddenPastCount: TimelineFiltersState["hiddenPastCount"];
  setShowAllPast: TimelineFiltersState["setShowAllPast"];
  showAllPast: TimelineFiltersState["showAllPast"];
  pastGroups: TimelineFiltersState["pastGroups"];
  hiddenFutureCount: TimelineFiltersState["hiddenFutureCount"];
  setShowAllFuture: TimelineFiltersState["setShowAllFuture"];
  showAllFuture: TimelineFiltersState["showAllFuture"];
  futureGroups: TimelineFiltersState["futureGroups"];
  allVisibleGroups: TimelineFiltersState["pastGroups"];
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  todayRef: TimelineData["todayRef"];
  handleMarkComplete: TimelineState["workoutActions"]["handleMarkComplete"];
  onCardClick: (entry: TimelineEntry) => void;
  handleCombine: TimelineState["combine"]["handleCombine"];
  combiningEntry: TimelineState["combine"]["combiningEntry"];
  personalRecords: TimelineData["personalRecords"];
  isAutoCoaching: boolean;
  annotationsByDate: Record<string, TimelineAnnotation[]>;
  onAddAnnotation: (date: string) => void;
  onEditAnnotation: (annotation: TimelineAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  isAnnotationDeleting: boolean;
  onMoveEntry: (entry: TimelineEntry, newDate: string) => void;
  isMovingEntry: boolean;
  isBulkSelectMode: boolean;
  selectedBulkEntryKeys: ReadonlySet<string>;
  onBulkSelectToggle: (entry: TimelineEntry) => void;
}

export function TimelineContent({
  timelineLoading,
  filterStatus,
  selectedPlanId,
  plans,
  samplePlanMutation,
  importMutation,
  handleFileUpload,
  setSchedulingPlanId,
  setFilterStatus,
  hiddenPastCount,
  setShowAllPast,
  showAllPast,
  pastGroups,
  hiddenFutureCount,
  setShowAllFuture,
  showAllFuture,
  futureGroups,
  allVisibleGroups,
  rowVirtualizer,
  todayRef,
  handleMarkComplete,
  onCardClick,
  handleCombine,
  combiningEntry,
  personalRecords,
  isAutoCoaching,
  annotationsByDate,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  isAnnotationDeleting,
  onMoveEntry,
  isMovingEntry,
  isBulkSelectMode,
  selectedBulkEntryKeys,
  onBulkSelectToggle,
}: Readonly<TimelineContentProps>) {
  if (timelineLoading) {
    return <TimelineSkeleton />;
  }

  // `allVisibleGroups` includes annotation-only rows from useTimelineFilters,
  // so this empty state is only for a truly empty render target.
  if (allVisibleGroups.length === 0) {
    return (
      <TimelineEmptyState
        filterStatus={filterStatus}
        selectedPlanId={selectedPlanId}
        plans={plans}
        samplePlanMutation={samplePlanMutation}
        importMutation={importMutation}
        handleFileUpload={handleFileUpload}
        setSchedulingPlanId={setSchedulingPlanId}
        setFilterStatus={setFilterStatus}
        onLogNote={() => onAddAnnotation(format(new Date(), "yyyy-MM-dd"))}
      />
    );
  }

  // Rows render in normal flow between spacer divs instead of being
  // absolutely positioned in a getTotalSize()-tall box: getTotalSize()
  // trails a row's real height for a frame after its content changes,
  // which let the trailing "Show more" button overlap the last card.
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const bottomSpacerHeight =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div className="space-y-4">
      {hiddenPastCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowAllPast(true)}
          data-testid="button-show-more-past"
        >
          <ChevronUp className="h-4 w-4 mr-2" />
          Show {hiddenPastCount} more past workout{hiddenPastCount > 1 ? "s" : ""}
        </Button>
      )}

      {showAllPast && pastGroups.length > 7 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowAllPast(false)}
          data-testid="button-hide-past"
        >
          Hide older workouts
        </Button>
      )}

      <div>
        <div style={{ height: `${topSpacerHeight}px` }} />
        {virtualRows.map((virtualRow) => {
          const [date, entries] = allVisibleGroups[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <TimelineDateGroup
                key={date}
                ref={isToday(parseISO(date)) ? todayRef : undefined}
                date={date}
                entries={entries}
                annotations={annotationsByDate[date]}
                onMarkComplete={handleMarkComplete}
                onClick={onCardClick}
                onCombineSelect={handleCombine}
                isCombining={!!combiningEntry}
                combiningEntryId={combiningEntry?.id || null}
                combiningEntryDate={combiningEntry?.date || null}
                personalRecords={personalRecords}
                isAutoCoaching={isAutoCoaching}
                onAddAnnotation={onAddAnnotation}
                onEditAnnotation={onEditAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                isAnnotationDeleting={isAnnotationDeleting}
                onMoveEntry={onMoveEntry}
                isMovingEntry={isMovingEntry}
                isBulkSelectMode={isBulkSelectMode}
                selectedBulkEntryKeys={selectedBulkEntryKeys}
                onBulkSelectToggle={onBulkSelectToggle}
              />
            </div>
          );
        })}
        <div style={{ height: `${bottomSpacerHeight}px` }} />
      </div>

      {hiddenFutureCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowAllFuture(true)}
          data-testid="button-show-more-future"
        >
          <ChevronDown className="h-4 w-4 mr-2" />
          Show {hiddenFutureCount} more upcoming workout{hiddenFutureCount > 1 ? "s" : ""}
        </Button>
      )}

      {showAllFuture && futureGroups.length > 7 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowAllFuture(false)}
          data-testid="button-hide-future"
        >
          Hide later workouts
        </Button>
      )}
    </div>
  );
}
