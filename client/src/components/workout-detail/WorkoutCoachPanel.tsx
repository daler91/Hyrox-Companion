import type { TimelineEntry } from "@shared/schema";
import type { ReactNode } from "react";

import { EmbeddedWorkoutCoachChat } from "./EmbeddedWorkoutCoachChat";
import { MobileCoachToggle } from "./MobileCoachToggle";

const SPLIT_WORKOUT_COACH_LAYOUT =
  "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]";
const MOBILE_WORKOUT_COACH_LAYOUT = "flex min-h-0 flex-1 flex-col";
const STACKED_WORKOUT_COACH_LAYOUT = "space-y-4";
const MOBILE_COACH_CARD =
  "min-h-0 flex-1 self-stretch overflow-hidden rounded-none border-0 bg-background";
const MOBILE_COACH_CHAT_AREA = "min-h-0 max-h-none flex-1";

interface WorkoutCoachPanelStateArgs {
  readonly coachChatOpen: boolean;
  readonly isMobile: boolean;
  readonly mobileCoachPanelOpen: boolean;
}

export interface WorkoutCoachPanelState {
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

export function getWorkoutCoachPanelState({
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

export function WorkoutCoachLayout({
  children,
  chat,
  detailsTestId,
  onShowCoachPanel,
  panelState,
  returnTestId,
}: WorkoutCoachLayoutProps) {
  return (
    <div className={panelState.layoutClassName}>
      <div className="min-w-0 space-y-4" hidden={panelState.detailsHidden} data-testid={detailsTestId}>
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

export function WorkoutCoachChatPanel({
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
      onBack={getCoachBackHandler(panelState.coachPanelOpen, onShowWorkoutDetails, onCloseCoachChat)}
      backButtonText={panelState.coachPanelOpen ? "Workout details" : undefined}
      chatAreaClassName={panelState.coachPanelOpen ? MOBILE_COACH_CHAT_AREA : undefined}
      className={panelState.coachPanelOpen ? MOBILE_COACH_CARD : undefined}
      isHidden={panelState.chatHidden}
      isPanelView={panelState.coachPanelOpen}
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
