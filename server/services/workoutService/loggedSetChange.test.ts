import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { logger } from "../../logger";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import { persistAdherenceSnapshot } from "./adherence";
import { refreshDerivedStateAfterLoggedSetChange } from "./loggedSetChange";

vi.mock("../../db", () => ({ db: { transaction: vi.fn(), select: vi.fn() } }));
vi.mock("./adherence", () => ({ persistAdherenceSnapshot: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));
vi.mock("../../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LOG_ID = "log-1";
const USER_ID = "user-1";
const LOGGED_SETS = [{ id: "s1", exerciseName: "romanian deadlift" }];

/** select({...}).from().where().for("update") — the row-locked log lookup. */
function lockedLogLookup(rows: unknown[]) {
  const forUpdate = vi.fn().mockResolvedValue(rows);
  return {
    chain: {
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ for: forUpdate }) }),
    },
    forUpdate,
  };
}

/** select().from().where().orderBy() — the log's current sets. */
function setsLookup(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }),
    }),
  };
}

/** select({...}).from().where() — the aiCoachEnabled read, outside the tx. */
function userLookup(rows: unknown[]) {
  return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) };
}

interface Scenario {
  readonly log?: { planDayId: string | null };
  readonly aiCoachEnabled?: boolean;
  readonly sets?: unknown[];
}

function setup({ log, aiCoachEnabled = true, sets = LOGGED_SETS }: Scenario) {
  const locked = lockedLogLookup(log ? [log] : []);
  const txSelect = vi.fn().mockReturnValueOnce(locked.chain).mockReturnValueOnce(setsLookup(sets));
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback({ select: txSelect } as unknown as Parameters<
      Parameters<typeof db.transaction>[0]
    >[0]),
  );
  vi.mocked(db.select).mockReturnValue(
    userLookup([{ aiCoachEnabled }]) as unknown as ReturnType<typeof db.select>,
  );
  return { forUpdate: locked.forUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshDerivedStateAfterLoggedSetChange", () => {
  it("rewrites adherence against the plan day and re-runs the coach", async () => {
    // The whole point: an athlete who corrects a completed session to the
    // exercises they actually did should not be left with a compliance
    // percentage and a coach note describing the sets they replaced.
    setup({ log: { planDayId: "day-7" } });

    await refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID);

    expect(persistAdherenceSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      LOG_ID,
      "day-7",
      LOGGED_SETS,
    );
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(USER_ID, "logged-sets-edited");
  });

  it("locks the log row so two edits landing together cannot persist a stale snapshot", async () => {
    const { forUpdate } = setup({ log: { planDayId: "day-7" } });

    await refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID);

    expect(forUpdate).toHaveBeenCalledWith("update");
  });

  it("skips adherence for a standalone log but still re-runs the coach", async () => {
    // An unlinked Strava import or an ad-hoc session has no prescription to
    // diff against, so there is no snapshot to keep true — but the coach still
    // has new work to read.
    setup({ log: { planDayId: null } });

    await refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID);

    expect(persistAdherenceSnapshot).not.toHaveBeenCalled();
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(USER_ID, "logged-sets-edited");
  });

  it("does nothing at all when the log is not this athlete's", async () => {
    // A wrong-owner request must not spend an AI call on somebody else's edit.
    setup({ log: undefined });

    await refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID);

    expect(persistAdherenceSnapshot).not.toHaveBeenCalled();
    expect(enqueueAutoCoachInBackground).not.toHaveBeenCalled();
  });

  it("keeps adherence true for an athlete who has AI coaching switched off", async () => {
    setup({ log: { planDayId: "day-7" }, aiCoachEnabled: false });

    await refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID);

    expect(persistAdherenceSnapshot).toHaveBeenCalled();
    expect(enqueueAutoCoachInBackground).not.toHaveBeenCalled();
  });

  it("never throws — the set write has already committed and been reported as saved", async () => {
    vi.mocked(db.transaction).mockRejectedValue(new Error("connection lost"));

    await expect(refreshDerivedStateAfterLoggedSetChange(LOG_ID, USER_ID)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    expect(enqueueAutoCoachInBackground).not.toHaveBeenCalled();
  });
});
