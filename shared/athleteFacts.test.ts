import { describe, expect, it } from "vitest";

import {
  ATHLETE_FACT_MAX_LENGTH,
  athleteFactKey,
  athleteFactReviewOn,
  isAthleteFactDue,
  normalizeFactText,
  splitIntoFacts,
} from "./athleteFacts";

describe("athlete fact keys", () => {
  it("treat case, spacing and a closing full stop as the same fact", () => {
    expect(athleteFactKey("No sled at my gym.")).toBe("no sled at my gym");
    expect(athleteFactKey("  no   sled at\nmy gym ")).toBe("no sled at my gym");
    expect(athleteFactKey("No sled at my gym!")).toBe("no sled at my gym");
  });

  it("keep different wording apart", () => {
    expect(athleteFactKey("No sled at my gym")).not.toBe(athleteFactKey("No rower at my gym"));
  });

  it("store the fact as one line", () => {
    expect(normalizeFactText("  Bad left\n knee  ")).toBe("Bad left knee");
  });
});

describe("review dates", () => {
  it("fall 90 days after the day a fact is stated, and come due on that day", () => {
    expect(athleteFactReviewOn("2026-10-01")).toBe("2026-12-30");
    expect(isAthleteFactDue("2026-12-30", "2026-12-29")).toBe(false);
    expect(isAthleteFactDue("2026-12-30", "2026-12-30")).toBe(true);
  });
});

describe("splitIntoFacts", () => {
  it("makes a fact of each sentence or line, without list markers", () => {
    expect(splitIntoFacts("Bad left knee. No sled at my gym!\n- Night shifts on Tuesdays; 1) Train mornings only")).toEqual([
      "Bad left knee.",
      "No sled at my gym!",
      "Night shifts on Tuesdays",
      "Train mornings only",
    ]);
  });

  it("keeps a fact once, and drops pieces with no words", () => {
    expect(splitIntoFacts("No sled at my gym. no sled at my gym\n\n-- \n...")).toEqual(["No sled at my gym."]);
  });

  it("cuts a sentence too long for a fact at the last word that fits", () => {
    const long = `Recovering from a ${"very ".repeat(40)}long injury`;
    const [fact] = splitIntoFacts(long);

    expect(fact.length).toBeLessThanOrEqual(ATHLETE_FACT_MAX_LENGTH);
    expect(fact.endsWith("very…")).toBe(true);
  });
});
