import { beforeEach, describe, expect, it, vi } from "vitest";

import { rawRequest, typedRequest } from "./client";
import { chat, coaching } from "./coaching";

vi.mock("./client", () => ({
  rawRequest: vi.fn(),
  typedRequest: vi.fn(),
}));

function historyResponse(rows: unknown[], headers: Record<string, string> = {}) {
  return {
    json: () => Promise.resolve(rows),
    headers: new Headers(headers),
  } as unknown as Response;
}

const CURSOR_HEADERS = {
  "X-Next-Cursor": "2026-10-01T08:30:00.000Z",
  "X-Next-Cursor-Id": "row-1",
};

describe("chat history API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CL56 (CODEBASE_ANALYSIS_2026-10-03): the cursor headers were never read.
  it("getHistoryPage() reads the older-page cursor from both headers", async () => {
    const rows = [{ id: "row-1" }];
    vi.mocked(rawRequest).mockResolvedValue(historyResponse(rows, CURSOR_HEADERS));

    const page = await chat.getHistoryPage();

    expect(rawRequest).toHaveBeenCalledWith("GET", "/api/v1/chat/history");
    expect(page).toEqual({
      messages: rows,
      nextCursor: { before: "2026-10-01T08:30:00.000Z", beforeId: "row-1" },
    });
  });

  it("getHistoryPage() sends the thread and the cursor back", async () => {
    vi.mocked(rawRequest).mockResolvedValue(historyResponse([]));

    const page = await chat.getHistoryPage(
      { focusPlanDayId: "day-1" },
      { before: "2026-10-01T08:30:00.000Z", beforeId: "row-1" },
    );

    expect(rawRequest).toHaveBeenCalledWith(
      "GET",
      "/api/v1/chat/history?focusPlanDayId=day-1&before=2026-10-01T08%3A30%3A00.000Z&beforeId=row-1",
    );
    expect(page.nextCursor).toBeNull();
  });

  it("getHistoryPage() takes half a cursor as none", async () => {
    vi.mocked(rawRequest).mockResolvedValue(
      historyResponse([], { "X-Next-Cursor": "2026-10-01T08:30:00.000Z" }),
    );

    expect((await chat.getHistoryPage()).nextCursor).toBeNull();
  });

  it("getHistory() returns the newest page's rows and reports its cursor", async () => {
    const rows = [{ id: "row-1" }];
    vi.mocked(rawRequest).mockResolvedValue(historyResponse(rows, CURSOR_HEADERS));
    const onNextCursor = vi.fn();

    const messages = await chat.getHistory({ focusWorkoutLogId: "log-1" }, onNextCursor);

    expect(rawRequest).toHaveBeenCalledWith("GET", "/api/v1/chat/history?focusWorkoutLogId=log-1");
    expect(messages).toEqual(rows);
    expect(onNextCursor).toHaveBeenCalledWith({
      before: "2026-10-01T08:30:00.000Z",
      beforeId: "row-1",
    });
  });
});

describe("coaching API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // PF4 (CODEBASE_ANALYSIS_2026-10-03)
  it("listSummaries() reads the materials without their text", () => {
    coaching.listSummaries();
    expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/coaching-materials/summaries");
  });
});
