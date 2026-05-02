import { describe, expect, it } from "vitest";

import workoutsRouter from "../workouts";
import composedRouter from "../workouts/index";

describe("workouts route composition compatibility", () => {
  it("exports the legacy workouts router", () => {
    expect(workoutsRouter).toBeDefined();
    expect(composedRouter).toBeDefined();
  });
});
