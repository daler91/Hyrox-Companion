import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type ChatFocus, type ChatHistoryMessage } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import type { SetMessages } from "../chatSessionModel";
import { useChatHistory } from "../useChatHistory";

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...mod,
    api: { ...mod.api, chat: { ...mod.api.chat, getHistory: vi.fn(), clearHistory: vi.fn() } },
  };
});

const getHistory = vi.mocked(api.chat.getHistory);
const clearHistory = vi.mocked(api.chat.clearHistory);

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: "Hi!",
  timestamp: "",
  createdAtMs: 0,
};

function savedRow(id: string, content: string): ChatHistoryMessage {
  return {
    id,
    userId: "user-1",
    role: "user",
    content,
    timestamp: new Date("2026-10-01T08:30:00Z"),
    kind: "text",
    proposalId: null,
    safetyNotice: null,
    ragInfo: null,
    focusPlanDayId: null,
    focusWorkoutLogId: null,
    feedback: null,
    feedbackAt: null,
    factProposal: null,
    attachment: null,
  };
}

const SAVED = [savedRow("row-1", "How far today?"), savedRow("row-2", "And tomorrow?")];

/** A refetch the server has not answered yet. */
function pendingHistory() {
  return Promise.withResolvers<ChatHistoryMessage[]>();
}

/** Mount the hook on a REAL query cache, with the chat buffer it writes to. */
function renderHistory(queryClient: QueryClient, focus?: ChatFocus) {
  let messages: Message[] = [WELCOME];
  const setMessages: SetMessages = (update) => {
    messages = typeof update === "function" ? update(messages) : update;
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useChatHistory({ welcomeMessage: WELCOME, setMessages, focus }), {
    wrapper,
  });
  return {
    ...view,
    ids: () => messages.map((m) => m.id),
    contentOf: (id: string) => messages.find((m) => m.id === id)?.content,
    /** What useChatSession's send does to the buffer: the athlete's turn and the reply it streams into. */
    send: (...sent: Message[]) => setMessages((current) => [...current, ...sent]),
  };
}

function localMessage(id: string, role: Message["role"], content: string): Message {
  return { id, role, content, timestamp: "", createdAtMs: 1_000 };
}

describe("useChatHistory", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clearHistory.mockResolvedValue({ success: true });
    // An empty conversation unless a test says otherwise. clearAllMocks keeps
    // implementations, so without this a refetch read the previous test's
    // history, or (run alone) `undefined`, which TanStack logs as an error.
    // CL17 (CODEBASE_ANALYSIS_2026-10-03)
    getHistory.mockResolvedValue([]);
  });

  it("loads the saved conversation into the chat once", async () => {
    getHistory.mockResolvedValue(SAVED);
    const { ids } = renderHistory(queryClient);

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "row-1", "row-2"]);
    });
  });

  // CL41 (CODEBASE_ANALYSIS_2026-10-03): the history replaced the buffer, so a
  // message sent before it arrived vanished with the reply streaming into it.
  it("keeps a message sent before the saved history arrives, after it", async () => {
    const history = pendingHistory();
    getHistory.mockReturnValueOnce(history.promise);
    const { result, ids, contentOf, send } = renderHistory(queryClient);
    expect(result.current.historyLoading).toBe(true);

    send(
      localMessage("sent-1", "user", "Easy run today?"),
      localMessage("reply-1", "assistant", "Keep it"),
    );
    await act(async () => {
      history.resolve(SAVED);
      await history.promise;
    });

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "row-1", "row-2", "sent-1", "reply-1"]);
    });
    expect(contentOf("reply-1")).toBe("Keep it");
  });

  it("shows a turn the history already saved once, as the copy that was sent here", async () => {
    const history = pendingHistory();
    getHistory.mockReturnValueOnce(history.promise);
    const { ids, contentOf, send } = renderHistory(queryClient);

    // The server saved the athlete's turn before answering the history read.
    send(
      localMessage("row-2", "user", "And tomorrow?"),
      localMessage("reply-2", "assistant", "Rest"),
    );
    await act(async () => {
      history.resolve(SAVED);
      await history.promise;
    });

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "row-1", "row-2", "reply-2"]);
    });
    expect(contentOf("reply-2")).toBe("Rest");
  });

  // CL17 (CODEBASE_ANALYSIS_2026-10-03): the cache still held the old history
  // while the post-clear refetch was in flight, so the re-armed hydration put
  // every cleared message back and then ignored the empty refetch.
  it("keeps a cleared conversation cleared while the refetch is in flight, and after", async () => {
    getHistory.mockResolvedValueOnce(SAVED);
    const { result, ids } = renderHistory(queryClient);
    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "row-1", "row-2"]);
    });
    const refetch = pendingHistory();
    getHistory.mockReturnValueOnce(refetch.promise);

    act(() => {
      result.current.clearHistory();
    });
    await waitFor(() => {
      expect(result.current.isClearingHistory).toBe(false);
    });
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["welcome"]);

    await act(async () => {
      refetch.resolve([]);
      await refetch.promise;
    });
    expect(ids()).toEqual(["welcome"]);
  });

  it("does not show a cleared workout thread to the next chat that opens it", async () => {
    const focus = { focusPlanDayId: "day-1" };
    getHistory.mockResolvedValueOnce([savedRow("thread-1", "Was that too hard?")]);
    const thread = renderHistory(queryClient, focus);
    await waitFor(() => {
      expect(thread.ids()).toEqual(["welcome", "thread-1"]);
    });
    thread.unmount();

    // The Coach panel clears; the server deletes every thread with it.
    getHistory.mockResolvedValueOnce([]);
    const panel = renderHistory(queryClient);
    await waitFor(() => {
      expect(panel.result.current.historyLoading).toBe(false);
    });
    act(() => {
      panel.result.current.clearHistory();
    });
    await waitFor(() => {
      expect(clearHistory).toHaveBeenCalledTimes(1);
    });
    // Let the clear settle and the panel's own refetch land, so the pending
    // read below is the reopened chat's.
    await waitFor(() => {
      expect(queryClient.isMutating()).toBe(0);
      expect(queryClient.isFetching()).toBe(0);
    });

    // Reopening the workout's chat reads the cache before its refetch lands.
    getHistory.mockReturnValueOnce(pendingHistory().promise);
    const reopened = renderHistory(queryClient, focus);
    await waitFor(() => {
      expect(reopened.result.current.historyLoading).toBe(false);
    });
    expect(reopened.ids()).toEqual(["welcome"]);
  });
});
