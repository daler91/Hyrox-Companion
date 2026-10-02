import { athleteFactCategoryEnum } from "@shared/schema/enums";
import { describe, expect, it } from "vitest";

import { createMockAthleteFact } from "../../../../../test/factories";
import { ATHLETE_FACT_CATEGORY_OPTIONS, groupAthleteFacts } from "./athleteCardModel";

describe("ATHLETE_FACT_CATEGORY_OPTIONS", () => {
  it("gives every category a label of its own", () => {
    const labels = new Set(ATHLETE_FACT_CATEGORY_OPTIONS.map((option) => option.label));
    expect(labels.size).toBe(athleteFactCategoryEnum.length);
  });
});

describe("groupAthleteFacts", () => {
  it("puts facts due for a check first, the longest overdue first, then the rest as stated", () => {
    const first = createMockAthleteFact({ id: "a", reviewOn: "2026-12-01" });
    const lateDue = createMockAthleteFact({ id: "b", reviewOn: "2026-09-20" });
    const earlyDue = createMockAthleteFact({ id: "c", reviewOn: "2026-08-01" });
    const dueToday = createMockAthleteFact({ id: "d", reviewOn: "2026-10-01" });
    const retired = createMockAthleteFact({ id: "e", active: false, reviewOn: "2026-01-01" });

    const card = groupAthleteFacts([first, lateDue, earlyDue, dueToday, retired], "2026-10-01");

    expect(card.active.map((fact) => fact.id)).toEqual(["c", "b", "d", "a"]);
    expect(card.retired.map((fact) => fact.id)).toEqual(["e"]);
  });
});
