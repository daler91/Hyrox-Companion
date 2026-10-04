import { describe, expect, it } from "vitest";

import {
  ATHLETE_FACT_MAX_LENGTH,
  athleteFactKey,
  athleteFactReviewOn,
  isAthleteFactDue,
  normalizeFactText,
  splitIntoFacts,
  standingConstraintsText,
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

  // D23 (CODEBASE_ANALYSIS_2026-10-03): the "2." of a decimal read as a list
  // marker, and every full stop ended a sentence, so these facts were stored
  // cut: "5 kg max on overhead press …", "See Dr." and "Patel before squatting".
  it("keeps a leading decimal, even straight after a sentence end", () => {
    expect(splitIntoFacts("2.5 kg max on overhead press after shoulder surgery")).toEqual([
      "2.5 kg max on overhead press after shoulder surgery",
    ]);
    expect(splitIntoFacts("Bad left knee. 2.5 kg max on overhead press\n- 10.5 km longest run")).toEqual([
      "Bad left knee.",
      "2.5 kg max on overhead press",
      "10.5 km longest run",
    ]);
  });

  it("doesn't end a sentence at an abbreviation", () => {
    expect(splitIntoFacts("See Dr. Patel before squatting. Avoid impact, e.g. box jumps")).toEqual([
      "See Dr. Patel before squatting.",
      "Avoid impact, e.g. box jumps",
    ]);
    expect(splitIntoFacts("Run approx. 5 km max. No sled")).toEqual(["Run approx. 5 km max.", "No sled"]);
    // "2024." on its own has no letters, so splitting at "Mar." lost the year.
    expect(splitIntoFacts("Shoulder surgery Mar. 2024. Light pressing only")).toEqual([
      "Shoulder surgery Mar. 2024.",
      "Light pressing only",
    ]);
  });

  it("still strips a numbered marker with or without a space after it", () => {
    expect(splitIntoFacts("1. Bad left knee\n2.No sled at my gym\n3) Night shifts")).toEqual([
      "Bad left knee",
      "No sled at my gym",
      "Night shifts",
    ]);
  });

  it("cuts a sentence too long for a fact at the last word that fits", () => {
    const long = `Recovering from a ${"very ".repeat(40)}long injury`;
    const [fact] = splitIntoFacts(long);

    expect(fact.length).toBeLessThanOrEqual(ATHLETE_FACT_MAX_LENGTH);
    expect(fact.endsWith("very…")).toBe(true);
  });
});

describe("standingConstraintsText", () => {
  it("is the older note, then every fact, one per line", () => {
    expect(standingConstraintsText(" Bad left knee. ", [{ fact: "No sled at my gym" }, { fact: "On beta blockers" }])).toBe(
      "Bad left knee.\nNo sled at my gym\nOn beta blockers",
    );
    expect(standingConstraintsText(null, [{ fact: "No sled at my gym" }])).toBe("No sled at my gym");
  });

  it("is null for an athlete who has said nothing", () => {
    expect(standingConstraintsText(null, [])).toBeNull();
    const factsNotLoaded = undefined;
    expect(standingConstraintsText("   ", factsNotLoaded)).toBeNull();
  });
});
