import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    CoachPanelChatArea: React.forwardRef<HTMLDivElement>((_props, ref) =>
      React.createElement("div", { ref, "data-testid": "coach-chat-area" }),
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

describe("EmbeddedWorkoutCoachChat", () => {
  beforeEach(() => {
    chatMocks.sendMessage.mockReset();
    chatMocks.cancelStream.mockReset();
    chatMocks.updateAutoScrollMode.mockReset();
    chatMocks.sendMessage.mockResolvedValue(undefined);
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

    await user.click(screen.getByTestId("embedded-workout-coach-chat-back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
