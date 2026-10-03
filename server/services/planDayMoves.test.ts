import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordMock, warnMock } = vi.hoisted(() => ({ recordMock: vi.fn(), warnMock: vi.fn() }));
vi.mock("../storage", () => ({ storage: { planDayMoves: { record: recordMock } } }));
vi.mock("../logger", () => ({ logger: { warn: warnMock } }));

import { recordPlanDayMove } from "./planDayMoves";

describe("recordPlanDayMove", () => {
  beforeEach(() => {
    recordMock.mockReset();
    warnMock.mockReset();
  });

  it("records a dated session given another date", async () => {
    await recordPlanDayMove("user-1", { planDayId: "day-1", fromDate: "2026-10-05", toDate: "2026-10-04", kind: "moved" });

    expect(recordMock).toHaveBeenCalledWith({
      userId: "user-1",
      planDayId: "day-1",
      fromDate: "2026-10-05",
      toDate: "2026-10-04",
      kind: "moved",
    });
  });

  it("records nothing for a session that kept its date, or had none on either side", async () => {
    await recordPlanDayMove("user-1", { planDayId: "day-1", fromDate: "2026-10-05", toDate: "2026-10-05", kind: "moved" });
    await recordPlanDayMove("user-1", { planDayId: "day-1", fromDate: null, toDate: "2026-10-05", kind: "moved" });
    await recordPlanDayMove("user-1", { planDayId: "day-1", fromDate: "2026-10-05", toDate: undefined, kind: "folded" });

    expect(recordMock).not.toHaveBeenCalled();
  });

  it("logs a failed write instead of failing the move that already landed", async () => {
    const error = new Error("db down");
    recordMock.mockRejectedValueOnce(error);

    await expect(
      recordPlanDayMove("user-1", { planDayId: "day-1", fromDate: "2026-10-05", toDate: "2026-10-06", kind: "shortened" }),
    ).resolves.toBeUndefined();

    expect(warnMock).toHaveBeenCalledWith({ err: error }, expect.stringContaining("Could not record a move"));
  });
});
