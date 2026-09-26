import { describe, expect, it } from "vitest";

import {
  appendCoachCue,
  formatCoachNotes,
  parseCoachNotes,
  splitCoachCueLabel,
} from "./coachNotes";

const REDUCE_CUE =
  "Load governor: cut total volume by about a third (fewer sets/intervals), hold the exercise selection, and keep effort easy to moderate.";
const ONRAMP_CUE =
  "Load governor on-ramp: trim total volume by about a fifth and keep effort controlled while load ramps back up.";

describe("parseCoachNotes", () => {
  it("returns empty parts for missing notes", () => {
    expect(parseCoachNotes(null)).toEqual({ athleteText: "", cues: [] });
    expect(parseCoachNotes("")).toEqual({ athleteText: "", cues: [] });
  });

  it("keeps notes without cues as athlete text", () => {
    expect(parseCoachNotes("Build endurance\nStrava: Lunch Run")).toEqual({
      athleteText: "Build endurance\nStrava: Lunch Run",
      cues: [],
    });
  });

  it("separates coach cues from the athlete's lines, wherever they sit", () => {
    expect(
      parseCoachNotes(
        "Build endurance, stay relaxed\n[AI Coach] Keep HR under 150 bpm.\nStrava: Lunch Run",
      ),
    ).toEqual({
      athleteText: "Build endurance, stay relaxed\nStrava: Lunch Run",
      cues: ["Keep HR under 150 bpm."],
    });
  });

  it("splits cues that share a line with other text", () => {
    expect(parseCoachNotes("Stay relaxed [AI Coach] Easy pace [AI Coach] Short stride")).toEqual({
      athleteText: "Stay relaxed",
      cues: ["Easy pace", "Short stride"],
    });
  });

  it("reads the legacy 'AI suggestion:' prefix as a cue", () => {
    expect(parseCoachNotes("Old notes\n\nAI suggestion: Keep two reps in reserve.")).toEqual({
      athleteText: "Old notes",
      cues: ["Keep two reps in reserve."],
    });
  });

  it("collapses repeated cues, ignoring case, spacing and trailing punctuation", () => {
    const notes = [
      "[AI Coach] Keep effort easy.",
      "[AI Coach] keep  effort easy",
      "[AI Coach] Hold form",
      "[AI Coach] Keep effort easy!",
    ].join("\n");
    expect(parseCoachNotes(notes).cues).toEqual(["Hold form", "Keep effort easy!"]);
  });

  it("keeps only the newest load-governor cue", () => {
    const notes = [
      `[AI Coach] ${ONRAMP_CUE}`,
      `[AI Coach] ${ONRAMP_CUE}`,
      `[AI Coach] ${REDUCE_CUE}`,
      "[AI Coach] Keep HR under 150 bpm.",
      `[AI Coach] ${REDUCE_CUE}`,
    ].join("\n");
    expect(parseCoachNotes(notes).cues).toEqual(["Keep HR under 150 bpm.", REDUCE_CUE]);
  });

  it("drops empty markers", () => {
    expect(parseCoachNotes("Notes\n[AI Coach]   ")).toEqual({ athleteText: "Notes", cues: [] });
  });
});

describe("appendCoachCue", () => {
  it("adds the first cue to empty notes", () => {
    expect(appendCoachCue(null, "Keep effort easy")).toBe("[AI Coach] Keep effort easy");
  });

  it("appends a new cue after the athlete's text", () => {
    expect(appendCoachCue("Knee felt tight", "Keep the squat depth shallow")).toBe(
      "Knee felt tight\n[AI Coach] Keep the squat depth shallow",
    );
  });

  it("is idempotent when the coach repeats a cue", () => {
    const once = appendCoachCue("Build endurance", REDUCE_CUE);
    expect(appendCoachCue(once, REDUCE_CUE)).toBe(once);
  });

  it("replaces an earlier load-governor cue instead of stacking", () => {
    const onramp = appendCoachCue("Build endurance", ONRAMP_CUE);
    expect(appendCoachCue(onramp, REDUCE_CUE)).toBe(`Build endurance\n[AI Coach] ${REDUCE_CUE}`);
  });

  it("cleans duplicates already stored in the notes", () => {
    const stored = [
      "Intervals",
      `[AI Coach] ${ONRAMP_CUE}`,
      `[AI Coach] ${ONRAMP_CUE}`,
      `[AI Coach] ${REDUCE_CUE}`,
      `[AI Coach] ${REDUCE_CUE}`,
    ].join("\n");
    expect(appendCoachCue(stored, REDUCE_CUE)).toBe(`Intervals\n[AI Coach] ${REDUCE_CUE}`);
  });

  it("keeps a multi-line cue on one line", () => {
    expect(appendCoachCue("", "Keep it easy.\n\nHeart-rate zones can be unreliable.")).toBe(
      "[AI Coach] Keep it easy. Heart-rate zones can be unreliable.",
    );
  });
});

describe("formatCoachNotes", () => {
  it("round-trips parsed notes", () => {
    const notes = "Build endurance\n[AI Coach] Keep HR under 150 bpm.";
    expect(formatCoachNotes(parseCoachNotes(notes))).toBe(notes);
  });
});

describe("splitCoachCueLabel", () => {
  it.each([
    [REDUCE_CUE, "Load governor"],
    [ONRAMP_CUE, "Load governor on-ramp"],
    ["Pacing: hold 5:10/km", "Pacing"],
  ])("splits the label off %s", (cue, label) => {
    expect(splitCoachCueLabel(cue).label).toBe(label);
  });

  it.each([
    "Keep heart rate under 150 bpm.",
    "Start at 5:10/km and build",
    "This is a much longer opening sentence that ends: with a colon",
  ])("leaves %s unlabelled", (cue) => {
    expect(splitCoachCueLabel(cue)).toEqual({ label: null, text: cue });
  });
});
