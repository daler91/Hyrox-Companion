import { describe, expect, it } from "vitest";

import { timelineStateReducer } from "../useTimelineState";

describe("timelineStateReducer", () => {
  it("updates selected plan via explicit select event", () => {
    const next = timelineStateReducer({ selectedPlanId: null }, { type: "plan.selected", planId: "plan-1" });
    expect(next.selectedPlanId).toBe("plan-1");
  });

  it("updates selected plan when scheduling finishes", () => {
    const next = timelineStateReducer({ selectedPlanId: "old" }, { type: "plan.scheduled", planId: "plan-2" });
    expect(next.selectedPlanId).toBe("plan-2");
  });
});
