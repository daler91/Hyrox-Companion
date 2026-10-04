import type { InsertWorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { storage } from "../../storage";
import { enqueueAutoCoach } from "../autoCoachQueue";
import { createWorkoutAndScheduleCoaching } from "./workouts";

vi.mock("../../db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../../storage", () => ({
  storage: {
    users: { updateIsAutoCoaching: vi.fn().mockResolvedValue(undefined) },
    plans: { getPlanForDate: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock("../autoCoachQueue", () => ({
  enqueueAutoCoach: vi.fn(),
  enqueueAutoCoachInBackground: vi.fn(),
}));
vi.mock("./structure", () => ({
  copyPrescribedSetsIntoLog: vi.fn(),
  copyPrescribedStructureIntoLog: vi.fn(),
  replaceWorkoutStructure: vi.fn(),
  resolveStructureBlocksForPersist: vi.fn(() => ({ source: "none", blocks: undefined })),
  structureReplacementOptions: vi.fn(),
}));
vi.mock("./adherence", () => ({ persistAdherenceSnapshot: vi.fn() }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const WORKOUT = { date: "2026-01-15", focus: "Run", mainWorkout: "5km easy" } as InsertWorkoutLog;

/** The creation transaction: insert the log, read aiCoachEnabled, raise the flag. */
function mockCreationTx() {
  const tx = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "log-1" }]) })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ aiCoachEnabled: true }]) })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
  };
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreationTx();
});

describe("createWorkoutAndScheduleCoaching — the pre-set isAutoCoaching flag", () => {
  it("leaves the flag up while a coach pass is queued", async () => {
    vi.mocked(enqueueAutoCoach).mockResolvedValue("job-1");

    await createWorkoutAndScheduleCoaching(WORKOUT, undefined, "user-1");
    await vi.waitFor(() => expect(enqueueAutoCoach).toHaveBeenCalledWith("user-1", "workout-created"));

    expect(storage.users.updateIsAutoCoaching).not.toHaveBeenCalled();
  });

  // AI12 (CODEBASE_ANALYSIS_2026-10-03): only a rejection used to clear the
  // flag. A send that resolved null queued nothing, and the "Coach is
  // reviewing" banner stayed up until the 15-minute stale reset.
  it("lowers the flag when the enqueue queued nothing", async () => {
    vi.mocked(enqueueAutoCoach).mockResolvedValue(null);

    await createWorkoutAndScheduleCoaching(WORKOUT, undefined, "user-1");

    await vi.waitFor(() =>
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false),
    );
  });

  it("lowers the flag when the enqueue fails", async () => {
    vi.mocked(enqueueAutoCoach).mockRejectedValue(new Error("pg-boss down"));

    await createWorkoutAndScheduleCoaching(WORKOUT, undefined, "user-1");

    await vi.waitFor(() =>
      expect(storage.users.updateIsAutoCoaching).toHaveBeenCalledWith("user-1", false),
    );
  });
});
