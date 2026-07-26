import type { TimelineEntry } from "@shared/schema";
import type { LucideIcon } from "lucide-react";
import { Dumbbell } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { CoachRationaleSection, DetailSection } from "./shared/DetailSection";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";
import {
  buildWorkoutSummaryStats,
  type SummaryVariant,
  WorkoutSummaryHeader,
} from "./shared/WorkoutSummaryHeader";
import { getWorkoutCoachPanelState, WorkoutCoachChatPanel, WorkoutCoachLayout } from "./WorkoutCoachPanel";

export interface WorkoutCoachSheetProps {
  readonly coachChatNonce?: number;
  readonly coachChatOpen?: boolean;
  readonly coachSeedText?: string;
  readonly mobileCoachPanelOpen?: boolean;
  readonly onCloseCoachChat?: () => void;
  readonly onShowCoachPanel?: () => void;
  readonly onShowWorkoutDetails?: () => void;
}

interface ReadOnlyWorkoutAction {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick?: () => void;
  readonly testId: string;
  readonly variant: React.ComponentProps<typeof Button>["variant"];
}

interface ReadOnlyWorkoutDetailSheetProps extends WorkoutCoachSheetProps {
  readonly entry: TimelineEntry;
  readonly onOpenChange: (open: boolean) => void;
  readonly renderActions: (seedText: string) => ReactNode;
  /** Optional extra panels rendered between the prescription summary and actions. */
  readonly renderPanels?: () => ReactNode;
  readonly returnTestId: string;
  readonly sheetTestId: string;
  readonly title: ReactNode;
  readonly detailsTestId: string;
  /** Renders the at-a-glance target tiles when set (e.g. "preview"). */
  readonly summaryVariant?: SummaryVariant;
}

export function ReadOnlyWorkoutActionGrid({ actions }: { readonly actions: ReadOnlyWorkoutAction[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {actions.map(({ icon: Icon, label, onClick, testId, variant }) =>
        onClick ? (
          <Button key={testId} type="button" variant={variant} onClick={onClick} data-testid={testId}>
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ) : null,
      )}
    </div>
  );
}

export function ReadOnlyWorkoutDetailSheet({
  coachChatNonce,
  coachChatOpen = false,
  coachSeedText,
  detailsTestId,
  entry,
  mobileCoachPanelOpen = false,
  onCloseCoachChat,
  onOpenChange,
  onShowCoachPanel,
  onShowWorkoutDetails,
  renderActions,
  renderPanels,
  returnTestId,
  sheetTestId,
  title,
  summaryVariant,
}: ReadOnlyWorkoutDetailSheetProps) {
  const isMobile = useIsMobile();
  const { distanceUnit } = useUnitPreferences();
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, entry.exerciseSets ?? []);
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });
  const hasPrescription =
    (entry.exerciseSets?.length ?? 0) > 0 || hasText(entry.mainWorkout) || hasText(entry.accessory);

  return (
    <ResponsiveSheet
      open
      onOpenChange={onOpenChange}
      title={title}
      description={formatScheduledDate(entry.date)}
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : undefined}
      mobileFullHeight={coachPanel.coachPanelOpen}
      desktopFullHeight={coachChatOpen}
      testId={sheetTestId}
    >
      <WorkoutCoachLayout
        panelState={coachPanel}
        detailsTestId={detailsTestId}
        returnTestId={returnTestId}
        onShowCoachPanel={onShowCoachPanel}
        chat={
          <WorkoutCoachChatPanel
            entry={entry}
            coachChatOpen={coachChatOpen}
            coachChatNonce={coachChatNonce}
            coachSeedText={coachSeedText}
            currentCoachSeedText={currentCoachSeedText}
            panelState={coachPanel}
            onCloseCoachChat={onCloseCoachChat}
            onShowWorkoutDetails={onShowWorkoutDetails}
          />
        }
      >
        {summaryVariant ? (
          <WorkoutSummaryHeader
            stats={buildWorkoutSummaryStats({
              entry,
              variant: summaryVariant,
              distanceUnit,
              showAdherence: false,
            })}
            testId={`${sheetTestId}-summary`}
          />
        ) : null}
        {hasPrescription ? (
          <DetailSection title="Workout" icon={Dumbbell}>
            <WorkoutPrescriptionSummary entry={entry} />
          </DetailSection>
        ) : null}
        <CoachRationaleSection rationale={entry.aiRationale} title="Why this workout" />
        {renderPanels?.()}
        {renderActions(currentCoachSeedText)}
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}

function hasText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}
