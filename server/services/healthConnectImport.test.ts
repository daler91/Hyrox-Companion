import type { HealthConnectSessionInput, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { importHealthConnectSessions, PROVIDER_APP_PACKAGES } from "./healthConnectImport";

vi.mock("../db", () => ({ db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) } }));
vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn(), getStravaConnection: vi.fn(), getGarminConnection: vi.fn() },
    workouts: {
      findUntouchedHealthConnectLogIds: vi.fn(),
      binWorkoutLogs: vi.fn(),
      getExistingHealthConnectIds: vi.fn(),
      listDeviceRecordingsForDates: vi.fn(),
      createHealthConnectWorkoutLogs: vi.fn(),
      createDeviceActivitySets: vi.fn(),
    },
  },
}));

const USER = "user-1";

function session(id: string, overrides: Partial<HealthConnectSessionInput> = {}): HealthConnectSessionInput {
  return { id, startTime: "2026-11-08T07:00:00Z", endTime: "2026-11-08T07:45:00Z", sportType: "Run", distanceMeters: 8000, ...overrides };
}

function createdRows() {
  return vi.mocked(storage.workouts.createHealthConnectWorkoutLogs).mock.calls.flatMap(([rows]) => rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.users.getUser).mockResolvedValue({ distanceUnit: "km", userTimezone: "Europe/London" } as never);
  vi.mocked(storage.users.getStravaConnection).mockResolvedValue(undefined);
  vi.mocked(storage.users.getGarminConnection).mockResolvedValue(undefined);
  vi.mocked(storage.workouts.findUntouchedHealthConnectLogIds).mockResolvedValue([]);
  vi.mocked(storage.workouts.binWorkoutLogs).mockImplementation(async (_user, ids) => ids.length);
  vi.mocked(storage.workouts.getExistingHealthConnectIds).mockResolvedValue([]);
  vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockResolvedValue([]);
  vi.mocked(storage.workouts.createHealthConnectWorkoutLogs).mockImplementation(
    async (rows) => rows.map((row, i) => ({ ...row, id: `log-${i}` }) as unknown as WorkoutLog),
  );
});

describe("importHealthConnectSessions", () => {
  it("imports new sessions with their set and skips ones already imported", async () => {
    vi.mocked(storage.workouts.getExistingHealthConnectIds).mockResolvedValue(["hc-old"]);
    const result = await importHealthConnectSessions(USER, {
      sessions: [session("hc-new"), session("hc-old", { startTime: "2026-11-07T07:00:00Z", endTime: "2026-11-07T07:45:00Z" })],
      deletedIds: [],
    });
    expect(result).toEqual({ imported: 1, skipped: 1, deleted: 0 });
    expect(createdRows().map((row) => row.healthConnectId)).toEqual(["hc-new"]);
    expect(vi.mocked(storage.workouts.createDeviceActivitySets).mock.calls[0][0]).toHaveLength(1);
  });

  it("leaves a connected provider's own sessions to that provider's sync", async () => {
    vi.mocked(storage.users.getStravaConnection).mockResolvedValue({ userId: USER } as never);
    const result = await importHealthConnectSessions(USER, {
      sessions: [
        session("from-strava", { dataOrigin: PROVIDER_APP_PACKAGES.strava }),
        session("from-garmin", { dataOrigin: PROVIDER_APP_PACKAGES.garmin, startTime: "2026-11-08T18:00:00Z", endTime: "2026-11-08T18:40:00Z" }),
      ],
      deletedIds: [],
    });
    // Garmin isn't connected here, so its app's session is the only copy coming.
    expect(createdRows().map((row) => row.healthConnectId)).toEqual(["from-garmin"]);
    expect(result.skipped).toBe(1);
  });

  it("keeps one of two apps' copies of a session, and none that Strava already recorded", async () => {
    vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockImplementation(async (_user, _dates, provider) =>
      provider === "strava"
        ? [{ startedAt: new Date("2026-11-08T18:00:30Z"), duration: 40, focus: "Ride", deviceActivity: null }]
        : [],
    );
    const result = await importHealthConnectSessions(USER, {
      sessions: [
        session("samsung"),
        session("fit", { startTime: "2026-11-08T07:01:00Z", endTime: "2026-11-08T07:45:30Z" }),
        session("ride", { sportType: "Ride", startTime: "2026-11-08T18:00:00Z", endTime: "2026-11-08T18:40:00Z" }),
      ],
      deletedIds: [],
    });
    expect(createdRows().map((row) => row.healthConnectId)).toEqual(["samsung"]);
    expect(result).toEqual({ imported: 1, skipped: 2, deleted: 0 });
  });

  it("bins the imports of sessions deleted in Health Connect that the athlete hasn't taken over", async () => {
    vi.mocked(storage.workouts.findUntouchedHealthConnectLogIds).mockResolvedValue(["log-a"]);
    const result = await importHealthConnectSessions(USER, { sessions: [], deletedIds: ["hc-a", "hc-b"] });
    expect(storage.workouts.findUntouchedHealthConnectLogIds).toHaveBeenCalledWith(USER, ["hc-a", "hc-b"]);
    expect(storage.workouts.binWorkoutLogs).toHaveBeenCalledWith(USER, ["log-a"]);
    expect(result).toEqual({ imported: 0, skipped: 0, deleted: 1 });
  });
});
