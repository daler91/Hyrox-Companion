import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import type { SetMessages } from "../chatSessionModel";
import { FEEDBACK_RETRY_MS, useMessageFeedback } from "../useMessageFeedback";

const toast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: { ...mod.api, chat: { ...mod.api.chat, setFeedback: vi.fn() } } };
});

const REPLY: Message = { id: "reply-1", role: "assistant", content: "Run easy.", timestamp: "", createdAtMs: 1, rateable: true };

/** The chat buffer the hook updates, and the ref it reads the current rating from. */
function renderFeedback(initial: Message) {
  const ref = { current: [initial] };
  const setMessages: SetMessages = (update) => {
    ref.current = typeof update === "function" ? update(ref.current) : update;
  };
  const { result } = renderHook(() => useMessageFeedback(setMessages, ref));
  return { rate: result.current, feedback: () => ref.current[0].feedback };
}

describe("useMessageFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the rating at once and saves it", async () => {
    vi.mocked(api.chat.setFeedback).mockResolvedValue({ id: "reply-1", feedback: "up" });
    const { rate, feedback } = renderFeedback(REPLY);

    rate("reply-1", "up");

    expect(feedback()).toBe("up");
    await waitFor(() => expect(api.chat.setFeedback).toHaveBeenCalledWith("reply-1", "up"));
    expect(toast).not.toHaveBeenCalled();
  });

  it("tries a reply that is still being saved once more, after a moment", async () => {
    vi.useFakeTimers();
    vi.mocked(api.chat.setFeedback)
      .mockRejectedValueOnce(new Error('404: {"error":"Message not found"}'))
      .mockResolvedValueOnce({ id: "reply-1", feedback: "down" });
    const { rate, feedback } = renderFeedback(REPLY);

    rate("reply-1", "down");
    await vi.advanceTimersByTimeAsync(FEEDBACK_RETRY_MS);

    expect(api.chat.setFeedback).toHaveBeenCalledTimes(2);
    expect(feedback()).toBe("down");
    expect(toast).not.toHaveBeenCalled();
  });

  it("puts the earlier rating back and says so when the save fails", async () => {
    vi.mocked(api.chat.setFeedback).mockRejectedValue(new Error("500: boom"));
    const { rate, feedback } = renderFeedback({ ...REPLY, feedback: "up" });

    rate("reply-1", "down");

    await waitFor(() => expect(feedback()).toBe("up"));
    expect(api.chat.setFeedback).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't save your rating", variant: "destructive" }));
  });
});
