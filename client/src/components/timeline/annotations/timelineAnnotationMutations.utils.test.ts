import { afterEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import {
  handleCreateAnnotationSuccess,
  handleDeleteAnnotationSuccess,
  invalidateTimelineAnnotationQueries,
} from "./timelineAnnotationMutations.utils";

describe("invalidateTimelineAnnotationQueries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyOnInvalidate() {
    return vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  }

  function invalidatedKeys(spy: ReturnType<typeof spyOnInvalidate>) {
    return spy.mock.calls.map(([filters]) => filters?.queryKey);
  }

  // The server derives a card's `excused`, `status` and `recoverable` from the
  // annotations, so an injury added or removed has to refresh the timeline as
  // well as the annotation list (CL10, CODEBASE_ANALYSIS_2026-10-03).
  it("refreshes the timeline, not only the annotation list and overview", () => {
    const spy = spyOnInvalidate();

    invalidateTimelineAnnotationQueries();

    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([
        QUERY_KEYS.timelineAnnotations,
        QUERY_KEYS.trainingOverview,
        QUERY_KEYS.timeline,
      ]),
    );
  });

  it("refreshes the timeline when an annotation is created", () => {
    const spy = spyOnInvalidate();
    const onCreated = vi.fn();

    handleCreateAnnotationSuccess({ toast: vi.fn(), type: "injury", onCreated });

    expect(invalidatedKeys(spy)).toContainEqual(QUERY_KEYS.timeline);
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("refreshes the timeline when an annotation is deleted", () => {
    const spy = spyOnInvalidate();

    handleDeleteAnnotationSuccess(vi.fn());

    expect(invalidatedKeys(spy)).toContainEqual(QUERY_KEYS.timeline);
  });
});
