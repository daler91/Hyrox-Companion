import { describe, expect, it } from "vitest";

import {
  BODY_SYSTEM_META,
  BODY_SYSTEMS,
  describeBodySystemDivergence,
  formatLoadChange,
  hasBodySystemLoadData,
  isNotableBodySystem,
} from "./bodySystemLoad";
import {
  bodySystemOverview,
  bodySystemSummary,
  emptyBodySystemOverview,
  legSpikeOverview,
} from "./bodySystemLoadTestFixtures";

describe("BODY_SYSTEM_META", () => {
  it("names and describes every system", () => {
    expect(new Set(Object.keys(BODY_SYSTEM_META))).toEqual(new Set(BODY_SYSTEMS));
    for (const meta of Object.values(BODY_SYSTEM_META)) {
      expect(meta.label).not.toBe("");
      expect(meta.noun).toBe(meta.noun.toLowerCase());
      expect(meta.description.length).toBeGreaterThan(20);
    }
  });
});

describe("formatLoadChange", () => {
  it("signs the change against the usual week", () => {
    expect(formatLoadChange(1.31)).toBe("+31%");
    expect(formatLoadChange(0.7)).toBe("-30%");
    expect(formatLoadChange(1)).toBe("0%");
  });
});

describe("hasBodySystemLoadData", () => {
  it("is false with nothing to show", () => {
    expect(hasBodySystemLoadData(null)).toBe(false);
    expect(hasBodySystemLoadData(emptyBodySystemOverview())).toBe(false);
  });

  it("is true once any system carried any load in the six weeks", () => {
    expect(hasBodySystemLoadData(legSpikeOverview())).toBe(true);
  });
});

describe("isNotableBodySystem", () => {
  it("calls out highs, new load and six-week highs but not a lighter week", () => {
    expect(isNotableBodySystem(bodySystemSummary("aerobic", { status: "high" }))).toBe(true);
    expect(isNotableBodySystem(bodySystemSummary("aerobic", { status: "very_high" }))).toBe(true);
    expect(isNotableBodySystem(bodySystemSummary("aerobic", { status: "new" }))).toBe(true);
    expect(isNotableBodySystem(bodySystemSummary("aerobic", { sixWeekHigh: true }))).toBe(true);
    expect(isNotableBodySystem(bodySystemSummary("aerobic", { status: "low" }))).toBe(false);
    expect(isNotableBodySystem(bodySystemSummary("aerobic"))).toBe(false);
  });
});

describe("describeBodySystemDivergence", () => {
  it("says nothing when no system stands out", () => {
    expect(
      describeBodySystemDivergence(
        bodySystemOverview({ upper_pull: { status: "low", ratio: 0.6 } }),
      ),
    ).toBeNull();
  });

  it("contrasts the spiking system with the normal ones", () => {
    expect(describeBodySystemDivergence(legSpikeOverview())).toBe(
      "Leg muscle load is at a six-week high (100% above your usual week), while aerobic and running impact loads are normal.",
    );
  });

  it("names several standouts and the lighter systems too", () => {
    expect(
      describeBodySystemDivergence(
        bodySystemOverview({
          aerobic: { status: "low", ratio: 0.7 },
          running_impact: { status: "very_high", ratio: 1.8 },
          leg_muscle: { status: "high", ratio: 1.35 },
          upper_pull: { status: "new", ratio: null, baseline: 10 },
        }),
      ),
    ).toBe(
      "Running impact load is 80% above your usual week, leg muscle load is 35% above your usual week and upper-body pull load jumped from almost none in the previous four weeks, while aerobic load is below usual.",
    );
  });

  it("stands alone when every other system is still building a baseline", () => {
    const building = { status: "insufficient_data" as const, ratio: null };
    expect(
      describeBodySystemDivergence(
        bodySystemOverview({
          aerobic: building,
          running_impact: building,
          leg_muscle: { status: "new", ratio: null },
          upper_pull: building,
        }),
      ),
    ).toBe("Leg muscle load jumped from almost none in the previous four weeks.");
  });
});
