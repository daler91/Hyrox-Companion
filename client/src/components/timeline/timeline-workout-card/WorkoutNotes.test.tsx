import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkoutNotes } from "./WorkoutNotes";

const REDUCE_CUE =
  "Load governor: cut total volume by about a third (fewer sets/intervals), hold the exercise selection, and keep effort easy to moderate.";

describe("WorkoutNotes", () => {
  it("renders plain notes without a coach section", () => {
    render(<WorkoutNotes entryId="e1" notes={"Build endurance\nStrava: Lunch Run"} />);

    expect(screen.getByTestId("text-notes-e1")).toHaveTextContent(
      "Build endurance Strava: Lunch Run",
    );
    expect(screen.queryByTestId("coach-cues-e1")).not.toBeInTheDocument();
  });

  it("lists each coach cue once, below the athlete's notes", () => {
    const notes = [
      "Build endurance, stay relaxed",
      "[AI Coach] Keep heart rate under 150 bpm.",
      `[AI Coach] ${REDUCE_CUE}`,
      `[AI Coach] ${REDUCE_CUE}`,
      "Strava: Lunch Run",
    ].join("\n");
    render(<WorkoutNotes entryId="e1" notes={notes} />);

    expect(screen.getByTestId("text-notes-e1")).toHaveTextContent(
      "Build endurance, stay relaxed Strava: Lunch Run",
    );
    const cues = within(screen.getByTestId("coach-cues-e1")).getAllByRole("listitem");
    expect(cues.map((cue) => cue.textContent)).toEqual([
      "Keep heart rate under 150 bpm.",
      REDUCE_CUE,
    ]);
    expect(within(cues[1]).getByText("Load governor:")).toBeInTheDocument();
  });

  it("omits the athlete paragraph when the notes are only coach cues", () => {
    render(<WorkoutNotes entryId="e1" notes="[AI Coach] Keep effort easy" />);

    expect(screen.queryByTestId("text-notes-e1")).not.toBeInTheDocument();
    expect(screen.getByTestId("coach-cues-e1")).toHaveTextContent("Coach cues");
  });

  it("renders nothing for notes that hold only empty markers", () => {
    const { container } = render(<WorkoutNotes entryId="e1" notes="[AI Coach]  " />);

    expect(container).toBeEmptyDOMElement();
  });
});
