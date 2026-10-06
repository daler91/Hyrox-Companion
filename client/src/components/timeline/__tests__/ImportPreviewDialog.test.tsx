import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ImportPreviewDialog, {
  type CsvPreviewData,
} from "@/components/timeline/ImportPreviewDialog";

function preview(overrides: Partial<CsvPreviewData> = {}): CsvPreviewData {
  return {
    fileName: "plan.csv",
    content: "Week,Day,Focus,Main Workout\n",
    rows: [
      { rowNumber: 1, weekNumber: 1, dayName: "Monday", focus: "Run", mainWorkout: "5 km easy" },
      {
        rowNumber: 2,
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Wall balls",
      },
    ],
    remainingRows: 0,
    ...overrides,
  };
}

function renderPreview(data: CsvPreviewData) {
  return render(
    <ImportPreviewDialog
      preview={data}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      isPending={false}
    />,
  );
}

// CL49 (CODEBASE_ANALYSIS_2026-10-03): the count came from raw lines, so a
// trailing newline made one more workout, and same-day sessions shared a key.
describe("ImportPreviewDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows two sessions on the same day without a duplicate-key warning", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderPreview(preview());

    expect(screen.getByText("5 km easy")).toBeInTheDocument();
    expect(screen.getByText("Wall balls")).toBeInTheDocument();
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("same key")),
    );
    expect(keyWarnings).toEqual([]);
  });

  it("counts the workouts after the preview from the parse, not the file's lines", () => {
    renderPreview(preview({ content: "lots\nof\nlines\n".repeat(10), remainingRows: 2 }));
    expect(screen.getByText("... and 2 more workouts")).toBeInTheDocument();
  });

  it("says nothing more when every workout is shown", () => {
    renderPreview(preview({ content: "line\n".repeat(20) }));
    expect(screen.queryByText(/more workouts/)).not.toBeInTheDocument();
  });
});
