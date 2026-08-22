import { describe, expect, it } from "vitest";

import { buildUseNextPatches, suggestNextTarget } from "../nextTarget";
import { makeLoggedSet as set } from "./exerciseSetFixture";

const KG = { category: "strength", weightUnit: "kg" } as const;
const LB = { category: "strength", weightUnit: "lb" } as const;

describe("suggestNextTarget", () => {
  it("adds a rep when that is the gentler 1RM overload", () => {
    // 80 kg × 8: +1 rep raises the Epley estimate by 2.7 kg, +2.5 kg by 3.2.
    const target = suggestNextTarget(
      [set({ id: "a", reps: 8, weight: 80 }), set({ id: "b", reps: 8, weight: 80 })],
      KG,
    );

    expect(target).toEqual({
      setCount: 2,
      reps: 9,
      weight: 80,
      step: { field: "reps", amount: 1 },
    });
  });

  it("adds a plate when that is the gentler 1RM overload", () => {
    // 100 kg × 5: +2.5 kg raises the estimate by 2.9 kg, +1 rep by 3.3.
    const target = suggestNextTarget([set({ reps: 5, weight: 100 })], KG);

    expect(target).toEqual({
      setCount: 1,
      reps: 5,
      weight: 102.5,
      step: { field: "weight", amount: 2.5 },
    });
  });

  it("steps in 5 lb for lb athletes", () => {
    const target = suggestNextTarget([set({ reps: 5, weight: 225 })], LB);

    expect(target).toMatchObject({ reps: 5, weight: 230, step: { field: "weight", amount: 5 } });
  });

  it("moves weight at the 10-rep Epley ceiling", () => {
    // Reps build to 10, then the plate moves — reps never leave the range
    // the estimated-1RM metric trusts.
    const target = suggestNextTarget([set({ reps: 10, weight: 60 })], KG);

    expect(target).toMatchObject({
      reps: 10,
      weight: 62.5,
      step: { field: "weight", amount: 2.5 },
    });
  });

  it("stays silent when the smallest step would leap the estimate", () => {
    // 12 kg × 10: the rep path is closed and +2.5 kg is a 21% 1RM jump —
    // a programme change, not an overload.
    expect(suggestNextTarget([set({ reps: 10, weight: 12 })], KG)).toBeNull();
  });

  it("stays silent outside the 2–10 rep Epley range", () => {
    // A heavy single already appears as a maxWeight PR; +2.5 kg on top of a
    // true single is not a suggestion a form should make.
    expect(suggestNextTarget([set({ reps: 1, weight: 140 })], KG)).toBeNull();
    // Above 10 reps the estimate degrades — and fixed-load race-station work
    // (wall balls et al.) lives up there and should not be nudged heavier.
    expect(suggestNextTarget([set({ reps: 15, weight: 40 })], KG)).toBeNull();
  });

  it("stays silent when last time's sets varied", () => {
    // A pyramid has no single prescription to progress.
    expect(
      suggestNextTarget([set({ id: "a", weight: 80 }), set({ id: "b", weight: 90 })], KG),
    ).toBeNull();
    expect(
      suggestNextTarget([set({ id: "a", reps: 8 }), set({ id: "b", reps: 6 })], KG),
    ).toBeNull();
  });

  it("stays silent for non-strength and bodyweight work", () => {
    expect(
      suggestNextTarget(
        [
          set({
            exerciseName: "easy_run",
            category: "running",
            reps: null,
            weight: null,
            distance: 5000,
          }),
        ],
        { category: "running", weightUnit: "kg" },
      ),
    ).toBeNull();
    expect(suggestNextTarget([set({ weight: null })], KG)).toBeNull();
    expect(suggestNextTarget([], KG)).toBeNull();
  });
});

describe("suggestNextTarget — a session that missed its prescription (audit H5)", () => {
  it("repeats the prescription instead of adding weight on top of a failure", () => {
    // Prescribed 3x5 @ 100 kg, managed 3 reps. The suggestion used to read the
    // three logged reps as a completed session and answer "102.5 kg".
    const missed = [
      set({ id: "a", reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 }),
      set({ id: "b", reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 }),
      set({ id: "c", reps: 3, weight: 100, plannedReps: 5, plannedWeight: 100 }),
    ];

    expect(suggestNextTarget(missed, KG)).toEqual({
      setCount: 3,
      reps: 5,
      weight: 100,
      step: { field: "repeat" },
    });
  });

  it("counts a shortfall on weight, not just on reps", () => {
    const missed = [set({ reps: 5, weight: 90, plannedReps: 5, plannedWeight: 100 })];

    expect(suggestNextTarget(missed, KG)).toMatchObject({
      reps: 5,
      weight: 100,
      step: { field: "repeat" },
    });
  });

  it("catches the last-set drop, whose varying reps used to fail the uniformity gate", () => {
    const missed = [
      set({ id: "a", reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 }),
      set({ id: "b", reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 }),
      set({ id: "c", reps: 4, weight: 100, plannedReps: 5, plannedWeight: 100 }),
    ];

    expect(suggestNextTarget(missed, KG)).toMatchObject({ step: { field: "repeat" } });
  });

  it("progresses normally when the prescription was met", () => {
    const met = [set({ reps: 5, weight: 100, plannedReps: 5, plannedWeight: 100 })];

    expect(suggestNextTarget(met, KG)).toMatchObject({
      weight: 102.5,
      step: { field: "weight", amount: 2.5 },
    });
  });

  it("progresses when the athlete beat the prescription", () => {
    const beaten = [set({ reps: 6, weight: 100, plannedReps: 5, plannedWeight: 100 })];

    expect(suggestNextTarget(beaten, KG)).toMatchObject({ step: { field: "weight", amount: 2.5 } });
  });

  it("progresses as before for an ad-hoc log with no prescription on the row", () => {
    const adHoc = [set({ reps: 5, weight: 100, plannedReps: null, plannedWeight: null })];

    expect(suggestNextTarget(adHoc, KG)).toMatchObject({ step: { field: "weight", amount: 2.5 } });
  });
});

describe("suggestNextTarget — light implements at the rep ceiling (audit L3)", () => {
  it("offers the fractional plate where the standard step would be too big a jump", () => {
    // 3x10 @ 20 kg: +2.5 kg is a 12.5% jump on the estimate and is rejected, so
    // the suggestion used to be silent here permanently — reps are capped at 10,
    // so nothing else could ever move.
    expect(suggestNextTarget([set({ reps: 10, weight: 20 })], KG)).toMatchObject({
      reps: 10,
      weight: 21.25,
      step: { field: "weight", amount: 1.25 },
    });
  });

  it("uses 2.5 lb as the fractional step for lb athletes", () => {
    expect(suggestNextTarget([set({ reps: 10, weight: 45 })], LB)).toMatchObject({
      weight: 47.5,
      step: { field: "weight", amount: 2.5 },
    });
  });

  it("still prefers the standard step when it fits", () => {
    // The fractional plate is a fallback, not a competitor: it must not pull the
    // ordinary reps-vs-weight crossover down with it.
    expect(suggestNextTarget([set({ reps: 10, weight: 60 })], KG)).toMatchObject({
      step: { field: "weight", amount: 2.5 },
    });
    expect(suggestNextTarget([set({ reps: 5, weight: 80 })], KG)).toMatchObject({
      step: { field: "reps", amount: 1 },
    });
  });

  it("stays silent below the weight where even the fractional plate is too big", () => {
    // 1.25 kg is 12.5% of the estimate at 10 kg. No standard gym step is small
    // enough, so no suggestion remains the honest answer.
    expect(suggestNextTarget([set({ reps: 10, weight: 10 })], KG)).toBeNull();
  });
});

describe("suggestNextTarget — the 25 kg float knife-edge (audit L2)", () => {
  it("decides the gain cap on the arithmetic, not on float representation", () => {
    // At 25 kg x 10 the standard step's gain equals the cap exactly. Computed as
    // a difference of two Epley products it came out 2.7e-15 high and tipped the
    // comparison the other way, so this case returned nothing.
    expect(suggestNextTarget([set({ reps: 10, weight: 25 })], KG)).toMatchObject({
      weight: 27.5,
      step: { field: "weight", amount: 2.5 },
    });
  });
});

describe("buildUseNextPatches", () => {
  it("writes the target onto every current set", () => {
    const target = {
      setCount: 2,
      reps: 9,
      weight: 80,
      step: { field: "reps", amount: 1 },
    } as const;

    const patches = buildUseNextPatches(
      [set({ id: "c1", reps: null, weight: null }), set({ id: "c2", reps: 6, weight: 70 })],
      target,
    );

    expect(patches).toEqual([
      { setId: "c1", patch: { reps: 9, weight: 80 } },
      { setId: "c2", patch: { reps: 9, weight: 80 } },
    ]);
  });
});
