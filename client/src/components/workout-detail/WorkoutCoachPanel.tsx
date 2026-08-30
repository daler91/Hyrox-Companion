import type { TimelineEntry } from "@shared/schema";
import type { ReactNode } from "react";

import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";
import { cn } from "@/lib/utils";

import { EmbeddedWorkoutCoachChat } from "./EmbeddedWorkoutCoachChat";
import { MobileCoachToggle } from "./MobileCoachToggle";

const SPLIT_WORKOUT_COACH_LAYOUT =
  "grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]";
const MOBILE_WORKOUT_COACH_LAYOUT = "flex min-h-0 flex-1 flex-col";
const STACKED_WORKOUT_COACH_LAYOUT = "space-y-4";
const MOBILE_COACH_CARD =
  "min-h-0 flex-1 self-stretch overflow-hidden rounded-none border-0 bg-background";
const EXPANDED_COACH_CHAT_AREA = "min-h-0 max-h-none flex-1";

interface WorkoutCoachPanelStateArgs {
  readonly coachChatOpen: boolean;
  readonly isMobile: boolean;
  readonly mobileCoachPanelOpen: boolean;
}

interface WorkoutCoachPanelState {
  readonly chatHidden: boolean;
  readonly coachPanelOpen: boolean;
  readonly detailsHidden: boolean;
  readonly layoutClassName: string;
  readonly returnButtonVisible: boolean;
}

interface WorkoutCoachLayoutProps {
  readonly children: ReactNode;
  readonly chat: ReactNode;
  readonly detailsTestId: string;
  readonly onShowCoachPanel?: () => void;
  readonly panelState: WorkoutCoachPanelState;
  readonly returnTestId: string;
}

interface WorkoutCoachChatPanelProps {
  readonly coachChatNonce?: number;
  readonly coachChatOpen: boolean;
  readonly coachSeedText?: string;
  readonly currentCoachSeedText: string;
  readonly entry: TimelineEntry;
  readonly onCloseCoachChat?: () => void;
  readonly onShowWorkoutDetails?: () => void;
  readonly panelState: WorkoutCoachPanelState;
}

/**
 * Coach-chat wiring shared by every workout detail surface. Timeline pages
 * hold this state and thread it into whichever sheet is open.
 */
export interface WorkoutCoachChatProps {
  readonly coachChatNonce?: number;
  readonly coachChatOpen?: boolean;
  readonly coachSeedText?: string;
  readonly mobileCoachPanelOpen?: boolean;
  readonly onCloseCoachChat?: () => void;
  readonly onShowCoachPanel?: () => void;
  readonly onShowWorkoutDetails?: () => void;
}

interface WorkoutCoachSheetProps extends WorkoutCoachChatProps {
  readonly children: ReactNode;
  /** Seed rebuilt from the entry's current sets, used when no explicit seed text arrives. */
  readonly currentCoachSeedText: string;
  readonly detailsTestId: string;
  readonly entry: TimelineEntry;
  /** Sheet width when the coach chat is closed; the open-chat width is shared. */
  readonly narrowContentClassName?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly returnTestId: string;
  readonly testId: string;
  readonly title: ReactNode;
}

/**
 * Shared sheet chrome for the workout detail surfaces (log, review,
 * read-only): a ResponsiveSheet hosting the details column and, when the
 * coach chat is open, the embedded coach panel beside or over it. Owns the
 * mobile/desktop panel-state plumbing so each surface only supplies its
 * own content and test ids.
 */
export function WorkoutCoachSheet({
  children,
  coachChatNonce,
  coachChatOpen = false,
  coachSeedText,
  currentCoachSeedText,
  detailsTestId,
  entry,
  mobileCoachPanelOpen = false,
  narrowContentClassName,
  onCloseCoachChat,
  onOpenChange,
  onShowCoachPanel,
  onShowWorkoutDetails,
  open,
  returnTestId,
  testId,
  title,
}: WorkoutCoachSheetProps) {
  const isMobile = useIsMobile();
  const panelState = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={formatScheduledDate(entry.date)}
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : narrowContentClassName}
      mobileFullHeight={panelState.coachPanelOpen}
      desktopFullHeight={coachChatOpen}
      testId={testId}
    >
      <WorkoutCoachLayout
        panelState={panelState}
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
            panelState={panelState}
            onCloseCoachChat={onCloseCoachChat}
            onShowWorkoutDetails={onShowWorkoutDetails}
          />
        }
      >
        {children}
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}

function getWorkoutCoachPanelState({
  coachChatOpen,
  isMobile,
  mobileCoachPanelOpen,
}: WorkoutCoachPanelStateArgs): WorkoutCoachPanelState {
  const coachPanelOpen = isMobile && coachChatOpen && mobileCoachPanelOpen;
  const showingMobileDetailsWithChat = isMobile && coachChatOpen && !mobileCoachPanelOpen;

  return {
    chatHidden: showingMobileDetailsWithChat,
    coachPanelOpen,
    detailsHidden: coachPanelOpen,
    layoutClassName: getWorkoutCoachLayoutClassName({ coachChatOpen, coachPanelOpen, isMobile }),
    returnButtonVisible: showingMobileDetailsWithChat,
  };
}

function WorkoutCoachLayout({
  children,
  chat,
  detailsTestId,
  onShowCoachPanel,
  panelState,
  returnTestId,
}: WorkoutCoachLayoutProps) {
  const detailsScrollable = panelState.layoutClassName === SPLIT_WORKOUT_COACH_LAYOUT;
  return (
    <div className={panelState.layoutClassName}>
      <div
        className={cn("min-w-0 space-y-4", detailsScrollable && "min-h-0 overflow-y-auto pr-1")}
        hidden={panelState.detailsHidden}
        data-testid={detailsTestId}
      >
        <MobileCoachToggle
          visible={panelState.returnButtonVisible}
          onClick={onShowCoachPanel}
          testId={returnTestId}
        />
        {children}
      </div>
      {chat}
    </div>
  );
}

function WorkoutCoachChatPanel({
  coachChatNonce,
  coachChatOpen,
  coachSeedText,
  currentCoachSeedText,
  entry,
  onCloseCoachChat,
  onShowWorkoutDetails,
  panelState,
}: WorkoutCoachChatPanelProps) {
  if (!coachChatOpen) return null;

  return (
    <EmbeddedWorkoutCoachChat
      entry={entry}
      seedText={coachSeedText ?? currentCoachSeedText}
      seedNonce={coachChatNonce}
      onBack={getCoachBackHandler(
        panelState.coachPanelOpen,
        onShowWorkoutDetails,
        onCloseCoachChat,
      )}
      backButtonText={panelState.coachPanelOpen ? "Workout details" : undefined}
      chatAreaClassName={EXPANDED_COACH_CHAT_AREA}
      className={panelState.coachPanelOpen ? MOBILE_COACH_CARD : undefined}
      isHidden={panelState.chatHidden}
    />
  );
}

function getWorkoutCoachLayoutClassName({
  coachChatOpen,
  coachPanelOpen,
  isMobile,
}: {
  readonly coachChatOpen: boolean;
  readonly coachPanelOpen: boolean;
  readonly isMobile: boolean;
}): string {
  if (coachPanelOpen) return MOBILE_WORKOUT_COACH_LAYOUT;
  if (coachChatOpen && !isMobile) return SPLIT_WORKOUT_COACH_LAYOUT;
  return STACKED_WORKOUT_COACH_LAYOUT;
}

function getCoachBackHandler(
  coachPanelOpen: boolean,
  onShowWorkoutDetails?: () => void,
  onCloseCoachChat?: () => void,
) {
  if (coachPanelOpen) return onShowWorkoutDetails ?? noop;
  return onCloseCoachChat ?? noop;
}

function noop(): undefined {
  return undefined;
}
