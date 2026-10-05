import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { invalidateAnalyticsCachesForUser } from "../../services/analyticsRouteCache";
import recycleBinRouter from "../recycleBin";
import workoutsRouter from "../workouts/index";
import { createTestApp, TEST_USER_ID } from "./testUtils";

/**
 * D10 (CODEBASE_ANALYSIS_2026-10-03): the analytics routes cache an athlete's
 * workout logs and sets for minutes, and before this only a set edit dropped
 * them. Every other workout write left Total Workouts, ACWR, PRs and
 * progression answering with pre-write numbers on the refetch that follows the
 * save. One row per write path the routes own; create, update and plan-day
 * assignment invalidate inside their use case (workoutUseCases.test.ts), and
 * the Strava and Garmin syncs in their own engines.
 */

const storageMocks = vi.hoisted(() => ({
  deleteWorkoutLog: vi.fn(),
  seedExerciseSetsFromPlanDay: vi.fn(),
  getUser: vi.fn(),
  getBinItem: vi.fn(),
  restore: vi.fn(),
  restoreBatch: vi.fn(),
  findOverlappingActivePlans: vi.fn(),
}));
const workoutWriteMocks = vi.hoisted(() => ({
  bulkDeleteWorkouts: vi.fn(),
  combineWorkouts: vi.fn(),
}));
const deviceLinkMocks = vi.hoisted(() => ({
  linkStandaloneDeviceLog: vi.fn(),
  unlinkDeviceActivity: vi.fn(),
  dismissDeviceLinkSuggestion: vi.fn(),
}));
const parseMocks = vi.hoisted(() => ({
  reparseWorkoutUseCase: vi.fn(),
  reparseWorkoutFromImageUseCase: vi.fn(),
  batchReparseWorkoutsUseCase: vi.fn(),
}));
const assistedMigrationMocks = vi.hoisted(() => ({
  runAssistedMigrationBackfill: vi.fn(),
  listBackfillReviews: vi.fn(),
  resolveBackfillReview: vi.fn(),
}));

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../middleware/aibudget", async () =>
  (await import("./testUtils")).mockAiBudgetModule(),
);
vi.mock("../../storage", () => ({
  storage: {
    workouts: {
      deleteWorkoutLog: storageMocks.deleteWorkoutLog,
      seedExerciseSetsFromPlanDay: storageMocks.seedExerciseSetsFromPlanDay,
    },
    users: { getUser: storageMocks.getUser },
    recycleBin: {
      get: storageMocks.getBinItem,
      restore: storageMocks.restore,
      restoreBatch: storageMocks.restoreBatch,
    },
    plans: { findOverlappingActivePlans: storageMocks.findOverlappingActivePlans },
  },
}));
vi.mock("../../queue", () => ({
  queue: {
    send: vi.fn(() => Promise.resolve()),
    sendDebounced: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../../services/analyticsRouteCache", () => ({
  invalidateAnalyticsCachesForUser: vi.fn(),
}));
vi.mock("../../services/workoutUseCases", () => ({
  createWorkout: vi.fn(),
  updateWorkoutUseCase: vi.fn(),
  assignWorkoutPlanDayUseCase: vi.fn(),
}));
vi.mock("../../services/workoutService", () => ({
  deriveMissingWorkoutSetsFromStructure: vi.fn(),
  updateWorkoutStructureBlockScore: vi.fn(),
}));
vi.mock("../../services/bulkDeleteWorkouts", () => ({
  BULK_DELETE_WORKOUTS_NOT_FOUND: "One or more workouts were not found",
  bulkDeleteWorkouts: workoutWriteMocks.bulkDeleteWorkouts,
  isBulkDeleteWorkoutsNotFoundError: () => false,
}));
vi.mock("../../services/combineWorkouts", () => ({
  combineWorkouts: workoutWriteMocks.combineWorkouts,
}));
vi.mock("../../services/deviceActivityLink", () => deviceLinkMocks);
vi.mock("../../services/sessionStreamHooks", () => ({ requestSessionStreamForLog: vi.fn() }));
vi.mock("../../services/parseWorkoutUseCases", () => parseMocks);
vi.mock("../../services/assistedMigrationService", () => assistedMigrationMocks);

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type WriteCase = {
  name: string;
  method: "post" | "delete";
  path: string;
  body?: Record<string, unknown>;
};

const WRITE_PATHS: WriteCase[] = [
  { name: "delete a workout", method: "delete", path: "/api/v1/workouts/w1" },
  {
    name: "bulk delete",
    method: "post",
    path: "/api/v1/workouts/bulk-delete",
    body: { workoutLogIds: ["w1", "w2"] },
  },
  {
    name: "combine",
    method: "post",
    path: "/api/v1/workouts/combine",
    body: {
      newWorkout: { date: "2026-10-01", focus: "Run", mainWorkout: "10 km" },
      deleteWorkoutIds: ["w1", "w2"],
    },
  },
  { name: "seed sets from the plan", method: "post", path: "/api/v1/workouts/w1/seed-from-plan" },
  {
    name: "link a device import",
    method: "post",
    path: "/api/v1/workouts/w1/device-link",
    body: { planDayId: "pd-1" },
  },
  { name: "unlink a device activity", method: "delete", path: "/api/v1/workouts/w1/device-link" },
  { name: "reparse", method: "post", path: "/api/v1/workouts/w1/reparse", body: {} },
  {
    name: "reparse from an image",
    method: "post",
    path: "/api/v1/workouts/w1/reparse-from-image",
    body: { mimeType: "image/png", imageBase64: PNG_BASE64 },
  },
  { name: "batch reparse", method: "post", path: "/api/v1/workouts/batch-reparse" },
  {
    name: "assisted-migration backfill",
    method: "post",
    path: "/api/v1/workouts/migration/backfill",
  },
  { name: "recycle-bin restore", method: "post", path: "/api/v1/recycle-bin/rb-1/restore" },
  {
    name: "recycle-bin batch restore",
    method: "post",
    path: "/api/v1/recycle-bin/batches/batch-1/restore",
  },
];

function buildApp(): express.Express {
  const router = Router();
  router.use(workoutsRouter);
  router.use(recycleBinRouter);
  return createTestApp(router);
}

function send(app: express.Express, write: WriteCase) {
  const call =
    write.method === "post" ? request(app).post(write.path) : request(app).delete(write.path);
  return write.body ? call.send(write.body) : call;
}

describe("workout writes drop the athlete's cached analytics (D10)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = buildApp();

    storageMocks.getUser.mockResolvedValue({ id: TEST_USER_ID, aiCoachEnabled: true });
    storageMocks.deleteWorkoutLog.mockResolvedValue({ recycleBinItemId: "rb-1" });
    storageMocks.seedExerciseSetsFromPlanDay.mockResolvedValue(3);
    storageMocks.getBinItem.mockResolvedValue({ id: "rb-1", payload: { kind: "workout_log" } });
    storageMocks.restore.mockResolvedValue({ ok: true });
    storageMocks.restoreBatch.mockResolvedValue({ ok: true });
    workoutWriteMocks.bulkDeleteWorkouts.mockResolvedValue({ success: true });
    workoutWriteMocks.combineWorkouts.mockResolvedValue({ id: "combined" });
    deviceLinkMocks.linkStandaloneDeviceLog.mockResolvedValue({ id: "w1" });
    deviceLinkMocks.unlinkDeviceActivity.mockResolvedValue({ log: null, standalone: { id: "s1" } });
    parseMocks.reparseWorkoutUseCase.mockResolvedValue({ status: "ok", response: { saved: true } });
    parseMocks.reparseWorkoutFromImageUseCase.mockResolvedValue({
      status: "ok",
      response: { saved: true },
    });
    parseMocks.batchReparseWorkoutsUseCase.mockResolvedValue({ reparsed: 2 });
    assistedMigrationMocks.runAssistedMigrationBackfill.mockResolvedValue({ processed: 1 });
  });

  it.each(WRITE_PATHS)("$name", async (write) => {
    const res = await send(app, write);

    expect(res.status).toBeLessThan(300);
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it.each<[string, string, () => void]>([
    [
      "a delete that found nothing",
      "delete a workout",
      () => {
        storageMocks.deleteWorkoutLog.mockImplementation(() => Promise.resolve());
      },
    ],
    [
      "a seed that wrote no set",
      "seed sets from the plan",
      () => {
        storageMocks.seedExerciseSetsFromPlanDay.mockResolvedValue(0);
      },
    ],
    [
      "a reparse of a workout that is not there",
      "reparse",
      () => {
        parseMocks.reparseWorkoutUseCase.mockResolvedValue({ status: "not_found" });
      },
    ],
    [
      "a restore that was refused",
      "recycle-bin restore",
      () => {
        storageMocks.restore.mockResolvedValue({ ok: false, reason: "not_found", message: "Gone" });
      },
    ],
  ])("leaves the caches alone after %s", async (_label, writeName, arrange) => {
    const write = WRITE_PATHS.find((candidate) => candidate.name === writeName);
    if (!write) throw new Error(`No write path named ${writeName}`);
    arrange();

    const res = await send(app, write);

    expect(res.status).toBe(writeName === "seed sets from the plan" ? 200 : 404);
    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/workouts/combine body (S9, CODEBASE_ANALYSIS_2026-10-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    workoutWriteMocks.combineWorkouts.mockResolvedValue({ id: "combined" });
  });

  it("strips planId and device provenance from the merged workout", async () => {
    const res = await request(buildApp())
      .post("/api/v1/workouts/combine")
      .send({
        newWorkout: {
          date: "2026-10-01",
          focus: "Run",
          mainWorkout: "10 km",
          planDayId: "pd-1",
          planId: "someone-elses-plan",
          source: "strava",
          stravaActivityId: "123",
          garminActivityId: "456",
          startedAt: "2026-10-01T07:00:00Z",
        },
        deleteWorkoutIds: ["w1", "w2"],
      });

    expect(res.status).toBe(201);
    const [input] = workoutWriteMocks.combineWorkouts.mock.calls[0] as [{ newWorkout: Record<string, unknown> }];
    expect(input.newWorkout).toEqual({
      date: "2026-10-01",
      focus: "Run",
      mainWorkout: "10 km",
      planDayId: "pd-1",
    });
  });
});
