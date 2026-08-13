import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInput } from "@/components/ChatInput";

const voiceInputMocks = vi.hoisted(() => ({
  isListening: false,
  stopListening: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isListening: voiceInputMocks.isListening,
    isSupported: false,
    interimTranscript: "",
    stopListening: voiceInputMocks.stopListening,
    toggleListening: vi.fn(),
  }),
}));

vi.mock("@/components/VoiceButton", () => ({
  VoiceButton: () => <button type="button" data-testid="voice-button" />,
}));

describe("ChatInput", () => {
  beforeEach(() => {
    voiceInputMocks.isListening = false;
    voiceInputMocks.stopListening.mockClear();
  });

  it("shows the desktop keyboard-shortcut hint while idle", () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByTestId("text-keyboard-hint")).toBeInTheDocument();
  });

  it("hides the keyboard-shortcut hint while a response is loading", () => {
    render(<ChatInput onSend={vi.fn()} isLoading />);
    expect(screen.queryByTestId("text-keyboard-hint")).not.toBeInTheDocument();
  });

  it("hides the keyboard-shortcut hint while voice input is listening", () => {
    voiceInputMocks.isListening = true;
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.queryByTestId("text-keyboard-hint")).not.toBeInTheDocument();
  });

  it("disables the send button until there is trimmed text to send", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId("button-send-message")).toBeDisabled();

    await user.type(screen.getByTestId("input-chat-message"), "   ");
    expect(screen.getByTestId("button-send-message")).toBeDisabled();

    await user.type(screen.getByTestId("input-chat-message"), "Row 500m");
    expect(screen.getByTestId("button-send-message")).toBeEnabled();
  });

  it("sends the trimmed message on submit and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const input = screen.getByTestId("input-chat-message");
    await user.type(input, "  How should I pace this?  ");
    await user.click(screen.getByTestId("button-send-message"));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("How should I pace this?");
    expect(input).toHaveValue("");
  });

  it("sends on Enter but inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const input = screen.getByTestId("input-chat-message");
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.type(input, "{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("line one\nline two");
    expect(input).toHaveValue("");
  });

  it("stops any active voice recording before sending", async () => {
    voiceInputMocks.isListening = true;
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await user.type(screen.getByTestId("input-chat-message"), "Log today's run");
    await user.click(screen.getByTestId("button-send-message"));

    expect(voiceInputMocks.stopListening).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Log today's run");
  });

  it("re-seeds the textarea when the seed's nonce changes", () => {
    const { rerender } = render(<ChatInput onSend={vi.fn()} seed={{ text: "Ask about my plan", nonce: 1 }} />);
    expect(screen.getByTestId("input-chat-message")).toHaveValue("Ask about my plan");

    // Clicking "Ask coach" again with the same text but a bumped nonce should
    // re-fill even though the user may have cleared the field in between.
    rerender(<ChatInput onSend={vi.fn()} seed={{ text: "Ask about my plan", nonce: 1 }} />);
    rerender(<ChatInput onSend={vi.fn()} seed={{ text: "Ask about my plan", nonce: 2 }} />);
    expect(screen.getByTestId("input-chat-message")).toHaveValue("Ask about my plan");
  });

  it("renders a stop button instead of send while loading with an onStop handler", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ChatInput onSend={vi.fn()} isLoading onStop={onStop} />);

    expect(screen.queryByTestId("button-send-message")).not.toBeInTheDocument();
    const stopButton = screen.getByTestId("button-stop-stream");
    await user.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables the textarea while loading", () => {
    render(<ChatInput onSend={vi.fn()} isLoading />);
    expect(screen.getByTestId("input-chat-message")).toBeDisabled();
  });
});
