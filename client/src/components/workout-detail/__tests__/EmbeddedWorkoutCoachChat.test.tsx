import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildWorkoutCoachSeedMessage,
  EmbeddedWorkoutCoachChat,
} from "../EmbeddedWorkoutCoachChat";

const chatMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  cancelStream: vi.fn(),
  updateAutoScrollMode: vi.fn(),
}));

vi.mock("@/hooks/useChatSession", () => ({
  useChatSession: () => ({
    messages: [],
    isLoading: false,
    isStreaming: false,
    scrollRef: { current: null },
    updateAutoScrollMode: chatMocks.updateAutoScrollMode,
    sendMessage: chatMocks.sendMessage,
    cancelStream: chatMocks.cancelStream,
  }),
}));

vi.mock("@/components/coach/CoachPanelChatArea", async () => {
  const React = await import("react");
  return {
    CoachPanelChatArea: React.forwardRef<HTMLDivElement, { className?: string }>((props, ref) =>
      React.createElement("div", {
        ref,
        "data-testid": "coach-chat-area",
        className: props.className,
      }),
    ),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isListening: false,
    isSupported: false,
    interimTranscript: "",
    stopListening: vi.fn(),
    toggleListening: vi.fn(),
  }),
}));

vi.mock("@/components/VoiceButton", () => ({
  VoiceButton: () => <button type="button" data-testid="voice-button" />,
}));

const entry = {
  id: "entry-1",
  date: "2026-05-09",
  focus: "Long Run",
} as TimelineEntry;

const exerciseSets = [
  {
    id: "set-1",
    exerciseName: "running",
    customLabel: null,
    category: "running",
    setNumber: 1,
    sortOrder: 0,
  },
  {
    id: "set-2",
    exerciseName: "running",
    customLabel: null,
    category: "running",
    setNumber: 2,
    sortOrder: 1,
  },
] as ExerciseSet[];

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

describe("EmbeddedWorkoutCoachChat", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    chatMocks.sendMessage.mockReset();
    chatMocks.cancelStream.mockReset();
    chatMocks.updateAutoScrollMode.mockReset();
    chatMocks.sendMessage.mockResolvedValue(undefined);
  });

  afterAll(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("seeds the chat input with workout context and returns to details", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(
      <EmbeddedWorkoutCoachChat
        entry={entry}
        seedText={buildWorkoutCoachSeedMessage(entry, exerciseSets)}
        onBack={onBack}
      />,
    );

    expect(screen.getByTestId("input-chat-message")).toHaveValue(
      "Can you walk me through your take on my Long Run workout on Saturday, May 9 (1 exercise, 2 sets)?",
    );
    expect(screen.getByTestId("embedded-workout-coach-chat")).toHaveClass("self-start");
    expect(screen.getByTestId("coach-chat-area")).toHaveClass("flex-none", "max-h-[320px]");
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("embedded-workout-coach-chat-back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("scrolls into view when mobile sheet context requests it", () => {
    const { rerender } = render(
      <EmbeddedWorkoutCoachChat
        entry={entry}
        seedText={buildWorkoutCoachSeedMessage(entry, exerciseSets)}
        seedNonce={1}
        onBack={vi.fn()}
        autoScrollIntoView
      />,
    );

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });

    rerender(
      <EmbeddedWorkoutCoachChat
        entry={entry}
        seedText={buildWorkoutCoachSeedMessage(entry, exerciseSets)}
        seedNonce={2}
        onBack={vi.fn()}
        autoScrollIntoView
      />,
    );

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
