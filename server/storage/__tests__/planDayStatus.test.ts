import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { syncPlanDayStatusFromWorkouts } from "../planDayStatus";

vi.mock("../../db", () => ({
  db: {
    query: {
      planDays: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    update: vi.fn(),
  },
}));

function mockPlanDay(overrides: Record<string, unknown> = {}) {
  return {
    id: "pd1",
    status: "completed",
    plan: { userId: "u1" },
    ...overrides,
  };
}

function mockCountQuery(count: number) {
  const whereMock = vi.fn().mockResolvedValue([{ count }]);
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.select).mockReturnValue({ from: fromMock } as unknown as ReturnType<typeof db.select>);
}

function mockUpdateSpy() {
  const whereMock = vi.fn().mockResolvedValue([]);
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  vi.mocked(db.update).mockReturnValue({ set: setMock } as unknown as ReturnType<typeof db.update>);
  return { whereMock, setMock };
}

describe("syncPlanDayStatusFromWorkouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the plan_day doesn't exist", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(undefined);
    await syncPlanDayStatusFromWorkouts("pd1", "u1");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the plan_day belongs to a different user", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ plan: { userId: "other-user" } }) as never,
    );
    await syncPlanDayStatusFromWorkouts("pd1", "u1");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("preserves 'skipped' status (explicit user intent)", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ status: "skipped" }) as never,
    );
    await syncPlanDayStatusFromWorkouts("pd1", "u1");
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("preserves 'missed' status (cron intent)", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ status: "missed" }) as never,
    );
    await syncPlanDayStatusFromWorkouts("pd1", "u1");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("reverts stale 'completed' to 'planned' when no workouts remain (S6)", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ status: "completed" }) as never,
    );
    mockCountQuery(0);
    const { setMock } = mockUpdateSpy();

    await syncPlanDayStatusFromWorkouts("pd1", "u1");

    expect(setMock).toHaveBeenCalledWith({ status: "planned" });
  });

  it("promotes 'planned' to 'completed' when a workout exists", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ status: "planned" }) as never,
    );
    mockCountQuery(1);
    const { setMock } = mockUpdateSpy();

    await syncPlanDayStatusFromWorkouts("pd1", "u1");

    expect(setMock).toHaveBeenCalledWith({ status: "completed" });
  });

  it("is a no-op when the derived status matches the current status", async () => {
    vi.mocked(db.query.planDays.findFirst).mockResolvedValue(
      mockPlanDay({ status: "completed" }) as never,
    );
    mockCountQuery(3);
    await syncPlanDayStatusFromWorkouts("pd1", "u1");
    expect(db.update).not.toHaveBeenCalled();
  });
});
