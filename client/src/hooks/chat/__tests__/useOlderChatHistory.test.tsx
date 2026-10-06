import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type ChatFocus,
  type ChatHistoryCursor,
  type ChatHistoryMessage,
  type ChatHistoryPage,
} from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import type { SetMessages } from "../chatSessionModel";
import { useChatHistory } from "../useChatHistory";
import { useOlderChatHistory, withOlderMessages } from "../useOlderChatHistory";

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      chat: {
        ...mod.api.chat,
        getHistory: vi.fn(),
        getHistoryPage: vi.fn(),
        clearHistory: vi.fn(),
      },
    },
  };
});

const getHistory = vi.mocked(api.chat.getHistory);
const getHistoryPage = vi.mocked(api.chat.getHistoryPage);
const clearHistory = vi.mocked(api.chat.clearHistory);

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: "Hi!",
  timestamp: "",
  createdAtMs: 0,
};

function savedRow(id: string): ChatHistoryMessage {
  return {
    id,
    userId: "user-1",
    role: "user",
    content: id,
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

function cursorAt(beforeId: string): ChatHistoryCursor {
  return { before: "2026-10-01T08:30:00.000Z", beforeId };
}

/** The newest page, as the server answers it: its rows and the cursor before them. */
function newestPage(rows: ChatHistoryMessage[], nextCursor: ChatHistoryCursor | null) {
  getHistory.mockImplementation((_focus, onNextCursor) => {
    onNextCursor?.(nextCursor);
    return Promise.resolve(rows);
  });
}

function olderPage(
  rows: ChatHistoryMessage[],
  nextCursor: ChatHistoryCursor | null,
): ChatHistoryPage {
  return { messages: rows, nextCursor };
}

/** Both history hooks on one chat buffer, as useChatSession mounts them. */
function renderChat(focus: ChatFocus = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let messages: Message[] = [WELCOME];
  const setMessages: SetMessages = (update) => {
    messages = typeof update === "function" ? update(messages) : update;
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const history = useChatHistory({ welcomeMessage: WELCOME, setMessages, focus });
      const older = useOlderChatHistory({ setMessages, focus, ready: !history.historyLoading });
      return { history, older };
    },
    { wrapper },
  );
  return { ...view, ids: () => messages.map((message) => message.id) };
}

describe("useOlderChatHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Unused one-shot answers would leak into the next test.
    getHistoryPage.mockReset();
    clearHistory.mockResolvedValue({ success: true });
    newestPage([], null);
  });

  // CL56 (CODEBASE_ANALYSIS_2026-10-03): the cursor headers were never read,
  // so nothing older than the newest 50 rows could be reached.
  it("loads the page before the newest one above the saved messages", async () => {
    newestPage([savedRow("row-1"), savedRow("row-2")], cursorAt("row-1"));
    getHistoryPage.mockResolvedValueOnce(olderPage([savedRow("old-1"), savedRow("old-2")], null));
    const { result, ids } = renderChat();
    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(true);
    });
    expect(ids()).toEqual(["welcome", "row-1", "row-2"]);

    act(() => {
      result.current.older.onLoad();
    });

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "old-1", "old-2", "row-1", "row-2"]);
    });
    expect(getHistoryPage).toHaveBeenCalledWith(
      { focusPlanDayId: undefined, focusWorkoutLogId: undefined },
      cursorAt("row-1"),
    );
    // That page reached the first message.
    expect(result.current.older.hasOlder).toBe(false);
  });

  it("offers nothing when the newest page is the whole conversation", async () => {
    newestPage([savedRow("row-1")], null);
    const { result, ids } = renderChat();

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "row-1"]);
    });
    expect(result.current.older.hasOlder).toBe(false);
  });

  it("goes back a page at a time from the cursor each page returns", async () => {
    newestPage([savedRow("row-1")], cursorAt("row-1"));
    getHistoryPage
      .mockResolvedValueOnce(olderPage([savedRow("old-2")], cursorAt("old-2")))
      .mockResolvedValueOnce(olderPage([savedRow("old-1")], null));
    const { result, ids } = renderChat();
    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(true);
    });

    act(() => {
      result.current.older.onLoad();
    });
    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "old-2", "row-1"]);
    });
    act(() => {
      result.current.older.onLoad();
    });

    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "old-1", "old-2", "row-1"]);
    });
    expect(getHistoryPage).toHaveBeenLastCalledWith(expect.anything(), cursorAt("old-2"));
    expect(result.current.older.hasOlder).toBe(false);
  });

  it("keeps offering a page that failed to load", async () => {
    newestPage([savedRow("row-1")], cursorAt("row-1"));
    getHistoryPage.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    const { result, ids } = renderChat();
    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(true);
    });

    act(() => {
      result.current.older.onLoad();
    });

    await waitFor(() => {
      expect(result.current.older.failed).toBe(true);
    });
    expect(result.current.older.hasOlder).toBe(true);
    expect(ids()).toEqual(["welcome", "row-1"]);
  });

  it("starts over once the conversation is cleared", async () => {
    newestPage([savedRow("row-1")], cursorAt("row-1"));
    getHistoryPage.mockResolvedValueOnce(olderPage([savedRow("old-1")], cursorAt("old-1")));
    const { result, ids } = renderChat();
    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(true);
    });
    act(() => {
      result.current.older.onLoad();
    });
    await waitFor(() => {
      expect(ids()).toEqual(["welcome", "old-1", "row-1"]);
    });
    newestPage([], null);

    act(() => {
      result.current.history.clearHistory();
    });

    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(false);
    });
    expect(ids()).toEqual(["welcome"]);
  });

  it("reads older pages of a workout's own thread", async () => {
    const focus = { focusPlanDayId: "day-1" };
    newestPage([savedRow("row-1")], cursorAt("row-1"));
    getHistoryPage.mockResolvedValueOnce(olderPage([], null));
    const { result } = renderChat(focus);
    await waitFor(() => {
      expect(result.current.older.hasOlder).toBe(true);
    });

    act(() => {
      result.current.older.onLoad();
    });

    await waitFor(() => {
      expect(getHistoryPage).toHaveBeenCalledWith(
        { focusPlanDayId: "day-1", focusWorkoutLogId: undefined },
        cursorAt("row-1"),
      );
    });
  });
});

describe("withOlderMessages", () => {
  it("leaves out rows already shown and keeps the welcome first", () => {
    const shown: Message[] = [WELCOME, { ...WELCOME, id: "row-1", content: "row-1" }];

    const next = withOlderMessages(shown, [savedRow("old-1"), savedRow("row-1")]);

    expect(next.map((message) => message.id)).toEqual(["welcome", "old-1", "row-1"]);
  });

  it("returns the same buffer when the page adds nothing", () => {
    const shown: Message[] = [WELCOME];

    expect(withOlderMessages(shown, [])).toBe(shown);
  });
});
