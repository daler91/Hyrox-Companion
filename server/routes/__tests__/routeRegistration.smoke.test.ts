import type { Server } from "node:http";

import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workoutsRouter = express.Router();
const genericRouter = express.Router();

vi.mock("../../clerkAuth", () => ({
  setupAuth: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../strava", () => ({ registerStravaRoutes: vi.fn() }));
vi.mock("../../garmin", () => ({ registerGarminRoutes: vi.fn() }));
vi.mock("../../middleware/csrf", () => ({
  csrfProtection: (_req: unknown, _res: unknown, next: () => void) => next(),
  csrfTokenHandler: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../routes/account", () => ({ default: genericRouter }));
vi.mock("../../routes/ai", () => ({ default: genericRouter }));
vi.mock("../../routes/analytics", () => ({ default: genericRouter }));
vi.mock("../../routes/auth", () => ({ default: genericRouter }));
vi.mock("../../routes/coaching", () => ({ default: genericRouter }));
vi.mock("../../routes/email", () => ({ default: genericRouter }));
vi.mock("../../routes/plans", () => ({ default: genericRouter }));
vi.mock("../../routes/preferences", () => ({ default: genericRouter }));
vi.mock("../../routes/push", () => ({ default: genericRouter }));
vi.mock("../../routes/timelineAnnotations", () => ({ default: genericRouter }));
vi.mock("../../routes/workouts/index", () => ({ default: workoutsRouter }));

describe("registerRoutes route-registration smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the workouts router exactly once", async () => {
    const { registerRoutes } = await import("../../routes");
    const app = express();
    const useSpy = vi.spyOn(app, "use");

    await registerRoutes({} as Server, app);

    const workoutsMounts = useSpy.mock.calls.filter(([first]) => first === workoutsRouter);
    expect(workoutsMounts).toHaveLength(1);
  });
});
