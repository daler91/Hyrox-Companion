import { beforeEach, describe, expect, it, vi } from "vitest";

import { analytics, timeline } from "./analytics";
import { typedRequest } from "./client";

vi.mock("./client", () => ({
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
  });

  describe("timeline", () => {
    it("get() calls typedRequest with GET and correct URL when planId is not provided", () => {
      timeline.get();
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/timeline");
    });

    it("get() calls typedRequest with GET and correct URL when planId is provided", () => {
      timeline.get("123");
      expect(typedRequest).toHaveBeenCalledWith("GET", "/api/v1/timeline?planId=123");
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
