import { CHAT_MESSAGE_MAX_LENGTH, CHAT_PHOTO_DEFAULT_MESSAGE, CHAT_PHOTO_MAX_BASE64_CHARS } from "@shared/chat";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInput } from "@/components/ChatInput";

const voiceInputMocks = vi.hoisted(() => ({
  isListening: false,
  stopListening: vi.fn(),
}));

const { toastMock, compressImageMock } = vi.hoisted(() => ({ toastMock: vi.fn(), compressImageMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// The resize itself needs a real canvas; here it hands back a shrunk photo.
vi.mock("@/lib/image", () => ({ compressImage: compressImageMock }));

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

  it("marks the send button aria-disabled until there is trimmed text to send", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId("button-send-message")).toHaveAttribute("aria-disabled", "true");

    await user.type(screen.getByTestId("input-chat-message"), "   ");
    expect(screen.getByTestId("button-send-message")).toHaveAttribute("aria-disabled", "true");

    await user.type(screen.getByTestId("input-chat-message"), "Row 500m");
    expect(screen.getByTestId("button-send-message")).toHaveAttribute("aria-disabled", "false");
  });

  it("does not send when the button is clicked with no trimmed text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await user.type(screen.getByTestId("input-chat-message"), "   ");
    await user.click(screen.getByTestId("button-send-message"));

    expect(onSend).not.toHaveBeenCalled();
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

  /** The counter the textarea points at, or null while it is hidden. */
  function lengthCounter(): HTMLElement | null {
    const id = screen.getByTestId("input-chat-message").getAttribute("aria-describedby");
    return id ? document.getElementById(id) : null;
  }

  it("shows the character count only once a message nears the limit", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} maxLength={20} />);
    const input = screen.getByTestId("input-chat-message");

    await user.type(input, "sixteen chars ok");
    expect(lengthCounter()).toBeNull();

    await user.type(input, "!");
    expect(lengthCounter()).toHaveTextContent("17/20");
  });

  it("blocks sending, without truncating, a message over the limit", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} maxLength={10} />);
    const input = screen.getByTestId("input-chat-message");

    await user.click(input);
    await user.paste("twelve chars");
    expect(input).toHaveValue("twelve chars");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(lengthCounter()).toHaveTextContent("2 characters over the limit");
    expect(screen.getByTestId("button-send-message")).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByTestId("button-send-message"));
    await user.type(input, "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("counts against the coach chat's limit by default", async () => {
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    await user.click(screen.getByTestId("input-chat-message"));
    const nearLimit = CHAT_MESSAGE_MAX_LENGTH * 0.8 + 1;
    await user.paste("x".repeat(nearLimit));
    expect(lengthCounter()).toHaveTextContent(`${nearLimit}/${CHAT_MESSAGE_MAX_LENGTH}`);
    expect(CHAT_MESSAGE_MAX_LENGTH).toBe(4000);
  });
});

describe("ChatInput photos (I20)", () => {
  const PHOTO = {
    blob: new Blob(["x"]),
    mimeType: "image/jpeg" as const,
    base64: "/9j/4AAQ",
    previewUrl: "blob:photo-1",
    width: 10,
    height: 10,
  };
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    compressImageMock.mockReset().mockResolvedValue(PHOTO);
    toastMock.mockReset();
    revokeObjectURL.mockReset();
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
  });

  async function attachPhoto(user: ReturnType<typeof userEvent.setup>) {
    await user.upload(screen.getByTestId("button-chat-photo-input"), new File(["x"], "watch.jpg", { type: "image/jpeg" }));
  }

  it("shows an attached photo and sends it with the message, then lets it go", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await attachPhoto(user);
    expect(await screen.findByAltText("Attachment to send")).toHaveAttribute("src", "blob:photo-1");
    await user.type(screen.getByTestId("input-chat-message"), "How was my pacing?{Enter}");

    expect(onSend).toHaveBeenCalledWith("How was my pacing?", {
      photo: { mimeType: "image/jpeg", imageBase64: "/9j/4AAQ" },
    });
    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
  });

  it("sends a photo on its own with a question, so the coach is asked something", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await attachPhoto(user);
    await screen.findByTestId("chat-photo-preview");
    expect(screen.getByTestId("button-send-message")).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByTestId("button-send-message"));

    expect(onSend).toHaveBeenCalledWith(CHAT_PHOTO_DEFAULT_MESSAGE, {
      photo: { mimeType: "image/jpeg", imageBase64: "/9j/4AAQ" },
    });
  });

  it("drops the photo when the athlete removes it", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    await attachPhoto(user);
    await user.click(await screen.findByRole("button", { name: "Remove photo" }));
    await user.type(screen.getByTestId("input-chat-message"), "Just words{Enter}");

    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
    expect(onSend).toHaveBeenCalledWith("Just words");
  });

  it("refuses a photo too large to send", async () => {
    compressImageMock.mockResolvedValueOnce({ ...PHOTO, base64: "x".repeat(CHAT_PHOTO_MAX_BASE64_CHARS + 1) });
    const user = userEvent.setup();
    render(<ChatInput onSend={vi.fn()} />);

    await attachPhoto(user);

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Photo too large" }));
    expect(screen.queryByTestId("chat-photo-preview")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
  });

  it("offers no photo button where photos aren't wanted", () => {
    render(<ChatInput onSend={vi.fn()} allowPhoto={false} />);

    expect(screen.queryByTestId("button-chat-photo")).toBeNull();
  });
});
