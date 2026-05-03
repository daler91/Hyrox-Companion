import { describe, expect, it } from "vitest";

import workoutsRouter from "../workouts/index";

describe("workouts route entrypoint", () => {
  it("exports the canonical workouts router from routes/workouts/index", () => {
    expect(workoutsRouter).toBeDefined();
  });
});
