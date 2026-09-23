import { beforeEach, describe, expect, it, vi } from "vitest";

import { analytics, timeline } from "./analytics";
import { rawRequest, typedRequest } from "./client";

vi.mock("./client", () => ({
  rawRequest: vi.fn(),
  typedRequest: vi.fn(),
}));

describe("analytics API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("analytics", () => {
    it("getPersonalRecords() calls typedRequest with GET and correct URL when dateParams is not provided", () => {
      analytics.getPersonalRecords();
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/personal-records");
    });

    it("getPersonalRecords() calls typedRequest with GET and correct URL when dateParams is provided", () => {
      analytics.getPersonalRecords("?range=month");
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/personal-records?range=month");
    });

    it("getExerciseAnalytics() calls typedRequest with GET and correct URL when dateParams is not provided", () => {
      analytics.getExerciseAnalytics();
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/exercise-analytics");
    });

    it("getExerciseAnalytics() calls typedRequest with GET and correct URL when dateParams is provided", () => {
      analytics.getExerciseAnalytics("?range=year");
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/exercise-analytics?range=year");
    });

    it("getTrainingOverview() calls typedRequest with GET and correct URL when dateParams is not provided", () => {
      analytics.getTrainingOverview();
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/training-overview");
    });

    it("getTrainingOverview() calls typedRequest with GET and correct URL when dateParams is provided", () => {
      analytics.getTrainingOverview("?range=week");
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/training-overview?range=week");
    });

    it("exportData() calls rawRequest with GET and correct URL", () => {
      analytics.exportData("csv");
      expect(rawRequest).toHaveBeenCalledWith("GET", "/api/v1/export?format=csv");
    });
  });

  describe("timeline", () => {
    function pageResponse(entries: unknown[], nextCursor: string | null) {
      return {
        json: () => Promise.resolve(entries),
        headers: new Headers(nextCursor ? { "X-Next-Cursor": nextCursor } : {}),
      } as unknown as Response;
    }

    it("getPage() requests the first page, with no query, when neither planId nor cursor is given", async () => {
      vi.mocked(rawRequest).mockResolvedValue(pageResponse([], null));
      const page = await timeline.getPage();
      expect(rawRequest).toHaveBeenCalledWith("GET", "/api/v1/timeline");
      expect(page).toEqual({ entries: [], nextCursor: null });
    });

    it("getPage() sends planId and the before cursor, and reads the next cursor from X-Next-Cursor", async () => {
      const entries = [{ id: "e1" }];
      vi.mocked(rawRequest).mockResolvedValue(pageResponse(entries, "2026-01-01"));
      const page = await timeline.getPage("123", "2026-02-01");
      expect(rawRequest).toHaveBeenCalledWith("GET", "/api/v1/timeline?planId=123&before=2026-02-01");
      expect(page).toEqual({ entries, nextCursor: "2026-01-01" });
    });

    it("getSuggestions() calls typedRequest with POST, correct URL, and timeout option", () => {
      timeline.getSuggestions();
      expect(typedRequest).toHaveBeenCalledWith(
        "POST",
        "/api/v1/timeline/ai-suggestions",
        {},
        { timeoutMs: 90000 },
      );
    });
  });
});
