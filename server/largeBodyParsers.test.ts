import { importPlanRequestSchema } from "@shared/schema";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "./errors";
import { needsLargeJsonBody, skipLargeJsonBodyPaths } from "./largeBodyParsers";
import { globalErrorHandler } from "./middleware/errorHandler";
import { protectedPatch, protectedPost } from "./routes/_helpers/protectedRouteBuilder";
import { validateBody } from "./routeUtils";

// A stand-in auth guard: only a request carrying the test header is signed in.
vi.mock("./routeGuards", () => ({
  protectedMutationGuards: [
    (req: Request, res: Response, next: NextFunction) => {
      if (req.headers["x-test-user"]) {
        next();
        return;
      }
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    },
  ],
}));
vi.mock("./middleware/aiConsent", () => ({ aiConsentCheck: vi.fn() }));
vi.mock("./middleware/aibudget", () => ({ aiBudgetCheck: vi.fn() }));

/** A JSON body of roughly `megabytes` MB. */
function bodyOf(megabytes: number): { message: string } {
  return { message: "x".repeat(Math.round(megabytes * 1024 * 1024)) };
}

describe("needsLargeJsonBody", () => {
  it.each([
    "/api/v1/chat",
    "/api/v1/chat/stream",
    "/api/v1/parse-exercises-from-image",
    "/api/v1/workouts/w-1/reparse-from-image",
    "/api/v1/nutrition/parse/photo",
    "/api/v1/coaching-materials",
    "/api/v1/coaching-materials/m-1",
    "/api/v1/plans/import",
  ])("is true for %s", (path) => {
    expect(needsLargeJsonBody(path)).toBe(true);
  });

  it.each([
    "/api/v1/workouts",
    "/api/v1/chat/history",
    "/api/v1/coaching-materials-extra",
    "/api/v1/account",
    "/api/v1/plans",
    "/api/v1/plans/import/extra",
  ])("is false for %s", (path) => {
    expect(needsLargeJsonBody(path)).toBe(false);
  });
});

// D35 (CODEBASE_ANALYSIS_2026-10-03): the multi-MB parsers used to run at app
// level, before auth and every rate limiter.
describe("large JSON bodies are parsed after auth and the rate limiter (D35)", () => {
  const handler = vi.fn((req: Request, res: Response) =>
    Promise.resolve(
      res.json({ received: (req.body as { message?: string } | undefined)?.message?.length ?? 0 }),
    ),
  );
  // What the body looked like when the rate limiter ran.
  const bodySeenByLimiter: unknown[] = [];
  const limiter = vi.fn((req: Request, _res: Response, next: NextFunction) => {
    bodySeenByLimiter.push(req.body);
    next();
  });

  // The same wiring as server/index.ts plus the protected route stack.
  const app = express();
  app.use(skipLargeJsonBodyPaths(express.json({ limit: "100kb" })));
  const router = express.Router();
  protectedPost(router, "/api/v1/chat", { limiter }, handler);
  protectedPost(router, "/api/v1/parse-exercises-from-image", { limiter }, handler);
  protectedPatch(router, "/api/v1/coaching-materials/:id", { limiter }, handler);
  protectedPost(router, "/api/v1/workouts", { limiter }, handler);
  app.use(router);
  app.use(globalErrorHandler);

  beforeEach(() => {
    handler.mockClear();
    limiter.mockClear();
    bodySeenByLimiter.length = 0;
  });

  it("turns an anonymous multi-MB body away at auth, before any limiter or parser", async () => {
    // Over the chat limit too: the old app-level parser answered this one 413,
    // which meant it had already buffered the whole body.
    const response = await request(app).post("/api/v1/chat").send(bodyOf(6));

    expect(response.status).toBe(401);
    expect(limiter).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("parses a signed-in athlete's large body only once the limiter has run", async () => {
    const response = await request(app)
      .post("/api/v1/chat")
      .set("x-test-user", "u-1")
      .send(bodyOf(3));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 3 * 1024 * 1024 });
    expect(bodySeenByLimiter).toEqual([undefined]);
  });

  it("gives each large-body route its own limit", async () => {
    const image = await request(app)
      .post("/api/v1/parse-exercises-from-image")
      .set("x-test-user", "u-1")
      .send(bodyOf(7));
    const material = await request(app)
      .patch("/api/v1/coaching-materials/m-1")
      .set("x-test-user", "u-1")
      .send(bodyOf(1.5));

    expect(image.status).toBe(200);
    expect(material.status).toBe(200);
  });

  it.each([
    { path: "/api/v1/chat", megabytes: 6 },
    { path: "/api/v1/coaching-materials/m-1", megabytes: 3 },
  ])(
    "keeps the 413 and its error shape for an oversized body on $path",
    async ({ path, megabytes }) => {
      const call = path.startsWith("/api/v1/coaching-materials")
        ? request(app).patch(path)
        : request(app).post(path);
      const response = await call.set("x-test-user", "u-1").send(bodyOf(megabytes));

      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        error: expect.any(String),
        code: ErrorCode.PAYLOAD_TOO_LARGE,
      });
      expect(limiter).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("keeps the 100kb default on every other route", async () => {
    const response = await request(app)
      .post("/api/v1/workouts")
      .set("x-test-user", "u-1")
      .send(bodyOf(0.2));

    expect(response.status).toBe(413);
    expect(response.body.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(limiter).not.toHaveBeenCalled();
  });

  it("leaves a small body on any other route parsed by the app-level parser", async () => {
    const response = await request(app)
      .post("/api/v1/workouts")
      .set("x-test-user", "u-1")
      .send({ message: "hi" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 2 });
    expect(bodySeenByLimiter).toEqual([{ message: "hi" }]);
  });
});

// C27 (CODEBASE_ANALYSIS_2026-10-03): plan import accepts 100,000 CSV
// characters, but its body went through the app-wide 100kb parser, so a
// schema-valid CSV with CRLF line endings or accented text got a generic 413.
describe("plan import has room for any CSV its schema accepts (C27)", () => {
  const CSV_MAX_CHARS = 100_000;
  const NAME_MAX_CHARS = 255;
  const importHandler = vi.fn((req: Request, res: Response) =>
    Promise.resolve(res.json({ received: (req.body as { csvContent: string }).csvContent.length })),
  );
  const passThrough = vi.fn((_req: Request, _res: Response, next: NextFunction) => {
    next();
  });

  const app = express();
  app.use(skipLargeJsonBodyPaths(express.json({ limit: "100kb" })));
  const router = express.Router();
  protectedPost(
    router,
    "/api/v1/plans/import",
    { limiter: passThrough, middleware: [validateBody(importPlanRequestSchema)] },
    importHandler,
  );
  app.use(router);
  app.use(globalErrorHandler);

  /** `row` repeated to exactly the schema's character cap. */
  function csvOf(row: string): string {
    return row.repeat(Math.ceil(CSV_MAX_CHARS / row.length)).slice(0, CSV_MAX_CHARS);
  }

  beforeEach(() => {
    importHandler.mockClear();
  });

  it.each([
    { label: "CRLF line endings", row: "1,Monday,Engine,Row 5x500m\r\n", name: "plan.csv" },
    {
      label: "accented text",
      row: "1,Mardi,Endurance,Fractionné 5×500 m à allure été\r\n",
      name: "séance.csv",
    },
    // Every character JSON-escaped to six bytes: the largest body the schema allows.
    { label: "worst-case JSON escaping", row: "\u0001", name: "\u0001".repeat(NAME_MAX_CHARS) },
  ])("accepts a full-size CSV with $label", async ({ row, name }) => {
    const body = { csvContent: csvOf(row), fileName: name, planName: name };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(100 * 1024);

    const response = await request(app)
      .post("/api/v1/plans/import")
      .set("x-test-user", "u-1")
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: CSV_MAX_CHARS });
  });

  it("still answers a body far past the schema's cap with the shaped 413", async () => {
    const response = await request(app)
      .post("/api/v1/plans/import")
      .set("x-test-user", "u-1")
      .send(bodyOf(1.5));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: expect.any(String), code: ErrorCode.PAYLOAD_TOO_LARGE });
    expect(importHandler).not.toHaveBeenCalled();
  });
});
