import { describe, expect, it } from "vitest";

import { inferSessionPriority, resolveSessionPriority } from "./sessionPriority";

describe("inferSessionPriority", () => {
  it.each([
    ["Threshold run", "key"],
    ["Long run", "key"],
    ["Tempo Run", "key"],
    ["Intervals", "key"],
    ["800m interval", "key"],
    ["Race simulation", "key"],
    ["HYROX sim", "key"],
    ["Race Day", "key"],
    ["5k time trial", "key"],
    // The long run is the week's long run however easy the pace.
    ["Easy long run", "key"],
    ["Easy run", "optional"],
    ["Easy aerobic", "optional"],
    ["Recovery run", "optional"],
    ["Mobility & stretching", "optional"],
    ["Yoga", "optional"],
    ["Shakeout", "optional"],
    ["Strength A — squat and bench", "supporting"],
    ["Stations — compromised running", "supporting"],
    ["Conditioning", "supporting"],
    // Not caught by a loose "walk" rule.
    ["Sled push & farmers walk", "supporting"],
  ])("reads %j as %s", (focus, tier) => {
    expect(inferSessionPriority(focus, "")).toBe(tier);
  });

  it("lets an explicit word in the title win", () => {
    expect(inferSessionPriority("Threshold (optional)", "")).toBe("optional");
    expect(inferSessionPriority("Key session: strength", "")).toBe("key");
  });

  it("reads only the title, not the workout text", () => {
    expect(inferSessionPriority("Lower body strength", "Finish with 10 min tempo")).toBe("supporting");
  });

  it("gives a rest day no tier", () => {
    expect(inferSessionPriority("Rest", "")).toBeNull();
    expect(inferSessionPriority("Active recovery", "")).toBeNull();
    expect(inferSessionPriority("Mobility", "Complete rest or light walk")).toBeNull();
  });
});

describe("resolveSessionPriority", () => {
  it("prefers the athlete's own tier", () => {
    expect(resolveSessionPriority({ priority: "optional", focus: "Threshold run", mainWorkout: "" })).toBe("optional");
    expect(resolveSessionPriority({ priority: "key", focus: "Easy run", mainWorkout: "" })).toBe("key");
  });

  it("infers when none was set, or the stored value is not a tier", () => {
    expect(resolveSessionPriority({ priority: null, focus: "Tempo", mainWorkout: "" })).toBe("key");
    expect(resolveSessionPriority({ priority: "urgent", focus: "Strength", mainWorkout: "" })).toBe("supporting");
  });

  it("never gives a rest day a tier, whatever is stored", () => {
    expect(resolveSessionPriority({ priority: "key", focus: "Rest day", mainWorkout: "" })).toBeNull();
  });
});
