import type { TimelineEntry } from "@shared/schema";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";
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
  readonly returnTestId: string;
  readonly sheetTestId: string;
  readonly title: ReactNode;
  readonly detailsTestId: string;
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
  returnTestId,
  sheetTestId,
  title,
}: ReadOnlyWorkoutDetailSheetProps) {
  const isMobile = useIsMobile();
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, entry.exerciseSets ?? []);
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

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
        <WorkoutPrescriptionSummary entry={entry} rationaleVariant="open" />
        <Separator />
        {renderActions(currentCoachSeedText)}
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}
