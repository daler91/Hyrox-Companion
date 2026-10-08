import type { TimelineAnnotation } from "@shared/schema";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTimelineDialogState } from "../useTimelineDialogState";

const ANNOTATION: TimelineAnnotation = {
  id: "a1",
  userId: "user-1",
  startDate: "2026-03-01",
  endDate: "2026-03-07",
  type: "injury",
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// U36 (CODEBASE_ANALYSIS_2026-10-03): Edit opened the create-only dialog.
describe("useTimelineDialogState annotations", () => {
  it("opens the dialog on the annotation Edit was pressed for", () => {
    const { result } = renderHook(() => useTimelineDialogState());

    act(() => {
      result.current.handleEditAnnotation(ANNOTATION);
    });

    expect(result.current.annotationsDialogOpen).toBe(true);
    expect(result.current.editingAnnotation).toBe(ANNOTATION);
  });

  it("opens Add on a fresh create form, not the last edit", () => {
    const { result } = renderHook(() => useTimelineDialogState());

    act(() => {
      result.current.handleEditAnnotation(ANNOTATION);
    });
    act(() => {
      result.current.handleAddAnnotation("2026-04-02");
    });

    expect(result.current.editingAnnotation).toBeNull();
    expect(result.current.annotationInitialDate).toBe("2026-04-02");
  });
});
