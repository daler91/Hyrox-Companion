import type { TimelineEntry } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { timelineCoachNotes, withCoachNotes } from "./timelineCoachNotes";

const entry = (id: string, notes: string | null): TimelineEntry =>
  ({ id, date: "2026-11-20", type: "planned", status: "planned", notes }) as TimelineEntry;

describe("timelineCoachNotes", () => {
  it("splits the athlete's text from the coach's cues, labels each cue and moves a repeat to the end", () => {
    expect(
      timelineCoachNotes(
        "Legs felt heavy\n[AI Coach] Pacing: hold 5:30/km\n[AI Coach] Keep it conversational.\n[AI Coach] Pacing: hold 5:30/km",
      ),
    ).toEqual({
      athleteText: "Legs felt heavy",
      cues: [
        { label: null, text: "Keep it conversational." },
        { label: "Pacing", text: "hold 5:30/km" },
      ],
    });
  });

  it("keeps only the newest load-governor cue", () => {
    expect(
      timelineCoachNotes("[AI Coach] Load governor on-ramp: trim 10%\n[AI Coach] Load governor reduction: trim 25%")?.cues,
    ).toEqual([{ label: "Load governor reduction", text: "trim 25%" }]);
  });

  it("is null for notes with nothing in them", () => {
    expect(timelineCoachNotes(null)).toBeNull();
    expect(timelineCoachNotes("  \n ")).toBeNull();
  });

  it("gives plain notes as the athlete's text with no cues", () => {
    expect(timelineCoachNotes("Easy day")).toEqual({ athleteText: "Easy day", cues: [] });
  });
});

describe("withCoachNotes", () => {
  it("adds coachNotes to entries with notes and leaves the rest as they were", () => {
    const withNotes = entry("a", "[AI Coach] Stay under 150 bpm");
    const without = entry("b", null);

    const [first, second] = withCoachNotes([withNotes, without]);

    expect(first).toEqual({ ...withNotes, coachNotes: { athleteText: "", cues: [{ label: null, text: "Stay under 150 bpm" }] } });
    expect(second).toBe(without);
  });
});
