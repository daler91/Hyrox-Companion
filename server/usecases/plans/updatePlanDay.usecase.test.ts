import { describe, expect, it, vi } from "vitest";

import { createUpdatePlanDayUseCase } from "./updatePlanDay.usecase";

describe("createUpdatePlanDayUseCase", () => {
  it("delegates to injected storage adapter", async () => {
    const updated = { id: "day-1" };
    const deps = { updatePlanDay: vi.fn().mockResolvedValue(updated) };

    const result = await createUpdatePlanDayUseCase(deps)({ dayId: "day-1", userId: "user-1", data: { focus: "Tempo" } });

    expect(deps.updatePlanDay).toHaveBeenCalledWith("day-1", { focus: "Tempo" }, "user-1");
    expect(result).toBe(updated);
  });
});
