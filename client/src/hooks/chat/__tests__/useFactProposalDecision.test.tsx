import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, QUERY_KEYS } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";
import { queryClient } from "@/lib/queryClient";

import type { SetMessages } from "../chatSessionModel";
import { useFactProposalDecision } from "../useFactProposalDecision";
import { FEEDBACK_RETRY_MS } from "../useMessageFeedback";

const toast = vi.fn<(content: { title?: string; description?: string; variant?: string }) => void>();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: { invalidateQueries: vi.fn(() => Promise.resolve()) },
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: { ...mod.api, chat: { ...mod.api.chat, decideFactProposal: vi.fn() } } };
});

const OFFER = { fact: "No sled at my gym", category: "equipment" as const, status: "pending" as const };
const REPLY: Message = { id: "reply-1", role: "assistant", content: "Noted.", timestamp: "", createdAtMs: 1, factProposal: OFFER };

function renderDecision(initial: Message) {
  const ref = { current: [initial] };
  const setMessages: SetMessages = (update) => {
    ref.current = typeof update === "function" ? update(ref.current) : update;
  };
  const { result } = renderHook(() => useFactProposalDecision(setMessages, ref));
  return { decide: result.current, status: () => ref.current[0].factProposal?.status };
}

describe("useFactProposalDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a saved fact at once, saves it, and refreshes the card", async () => {
    vi.mocked(api.chat.decideFactProposal).mockResolvedValue({ factProposal: { ...OFFER, status: "saved" } });
    const { decide, status } = renderDecision(REPLY);

    decide("reply-1", "save");

    expect(status()).toBe("saved");
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved to your athlete card" }));
    });
    expect(api.chat.decideFactProposal).toHaveBeenCalledWith("reply-1", "save");
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.athleteFacts });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.chatHistory });
  });

  it("puts the offer back and says why when the card is full", async () => {
    vi.mocked(api.chat.decideFactProposal).mockRejectedValue(
      new Error('409: {"error":"Your card holds up to 20 facts. Retire one that no longer applies first."}'),
    );
    const { decide, status } = renderDecision(REPLY);

    decide("reply-1", "save");

    await waitFor(() => {
      expect(status()).toBe("pending");
    });
    const shown = toast.mock.calls.at(-1)?.[0];
    expect(shown).toMatchObject({ title: "Couldn't save that fact", variant: "destructive" });
    expect(shown?.description).toContain("holds up to 20");
  });

  it("turns an offer down, trying once more while the reply is still being saved", async () => {
    vi.useFakeTimers();
    vi.mocked(api.chat.decideFactProposal)
      .mockRejectedValueOnce(new Error('404: {"error":"No fact is waiting"}'))
      .mockResolvedValueOnce({ factProposal: { ...OFFER, status: "dismissed" } });
    const { decide, status } = renderDecision(REPLY);

    decide("reply-1", "dismiss");
    await vi.advanceTimersByTimeAsync(FEEDBACK_RETRY_MS);

    expect(api.chat.decideFactProposal).toHaveBeenCalledTimes(2);
    expect(status()).toBe("dismissed");
    expect(toast).not.toHaveBeenCalled();
  });

  it("answers an offer only once", () => {
    const { decide } = renderDecision({ ...REPLY, factProposal: { ...OFFER, status: "saved" } });

    decide("reply-1", "dismiss");

    expect(api.chat.decideFactProposal).not.toHaveBeenCalled();
  });
});
