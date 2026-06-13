import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkoutContentsStatus } from "./WorkoutContentsStatus";

describe("WorkoutContentsStatus", () => {
  it("pluralizes the exercise count and surfaces the source label", () => {
    render(<WorkoutContentsStatus exerciseCount={2} sourceLabel="from coach text" />);
    const status = screen.getByTestId("workout-contents-status");
    expect(status).toHaveTextContent("2 exercises");
    expect(status).toHaveTextContent("from coach text");
  });

  it("uses the singular exercise label for one exercise", () => {
    render(<WorkoutContentsStatus exerciseCount={1} />);
    expect(screen.getByText("1 exercise")).toBeInTheDocument();
  });

  it("appends a pluralized structure block count to the label", () => {
    render(<WorkoutContentsStatus exerciseCount={3} structureBlockCount={2} />);
    expect(screen.getByText(/^3 exercises .*2 blocks$/)).toBeInTheDocument();
  });

  it("uses the singular block label for a single block", () => {
    render(<WorkoutContentsStatus exerciseCount={1} structureBlockCount={1} />);
    expect(screen.getByText(/^1 exercise .*1 block$/)).toBeInTheDocument();
  });

  it("shows an empty state with no exercises or source", () => {
    render(<WorkoutContentsStatus exerciseCount={0} />);
    const status = screen.getByTestId("workout-contents-status");
    expect(status).toHaveTextContent("Empty");
    expect(status).toHaveTextContent("Add exercise rows or a description");
  });

  it("reports a captured description when source text exists without rows", () => {
    render(<WorkoutContentsStatus exerciseCount={0} sourceLabel="from coach text" />);
    const status = screen.getByTestId("workout-contents-status");
    expect(status).toHaveTextContent("Description captured");
    expect(status).toHaveTextContent("No exercise rows yet");
  });

  it("honors a custom summary label", () => {
    render(<WorkoutContentsStatus exerciseCount={1} summaryLabel="Results contents" />);
    expect(screen.getByTestId("workout-contents-status")).toHaveTextContent("Results contents");
  });
});
