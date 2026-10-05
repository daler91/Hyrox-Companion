import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkDeleteControls } from "../BulkDeleteControls";

const handlers = {
  onConfirmOpenChange: vi.fn(),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  onConfirmDelete: vi.fn(),
};

function renderConfirm(selectedCount: number) {
  return render(
    <BulkDeleteControls
      enabled
      selectedCount={selectedCount}
      visibleCount={5}
      isPending={false}
      confirmOpen
      {...handlers}
    />,
  );
}

describe("BulkDeleteControls confirmation", () => {
  // Bulk delete removes a completed planned session's log, not its plan day,
  // so the day reads planned again, or missed once its date has passed (the
  // timeline derives missed for a past planned day). The copy said only
  // "remove from your timeline". CL23 (CODEBASE_ANALYSIS_2026-10-03)
  it("says completed planned sessions keep their plan days, shown as planned or missed", () => {
    renderConfirm(3);

    const description = screen.getByText(/This will remove 3 selected workouts from/);
    expect(description).toHaveTextContent(
      "Completed planned sessions keep their plan days: only their logged workouts are removed, and each day shows as planned again, or missed if its date has passed.",
    );
  });

  it("uses the singular for one selected workout", () => {
    renderConfirm(1);

    expect(screen.getByText(/This will remove 1 selected workout from/)).toBeInTheDocument();
  });
});
