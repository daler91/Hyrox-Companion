import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuth = vi.fn();

vi.mock("@clerk/express", () => ({ getAuth: (req: Request) => getAuth(req) }));
vi.mock("../env", () => ({
  env: { NODE_ENV: "test", CSRF_SECRET: "test-csrf-secret-test-csrf-secret-0123" },
}));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { bearerAuthState, csrfProtection, csrfTokenHandler } from "./csrf";

const CLERK_NOT_INSTALLED = () => {
  throw new Error("Clerk: getAuth() was called but Clerk middleware was not detected");
};

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.get("/api/v1/csrf-token", csrfTokenHandler);
  app.use("/api/v1", csrfProtection);
  app.get("/api/v1/thing", (_req, res) => res.json({ ok: true }));
  app.post("/api/v1/thing", (_req, res) => res.json({ ok: true }));
  app.delete("/api/v1/thing", (_req, res) => res.json({ ok: true }));
  app.use((err: { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ code: err.code ?? "ERROR" });
  });
  return app;
}

describe("csrfProtection with bearer-token clients", () => {
  beforeEach(() => {
    getAuth.mockReset();
  });

  it("lets a mutation Clerk authenticated from the Authorization header through without a CSRF token", async () => {
    getAuth.mockReturnValue({ userId: "user_native" });

    const res = await request(buildApp()).post("/api/v1/thing").set("Authorization", "Bearer token-abc").send({});

    expect(res.status).toBe(200);
  });

  it("exempts DELETE the same way as POST", async () => {
    getAuth.mockReturnValue({ userId: "user_native" });

    const res = await request(buildApp()).delete("/api/v1/thing").set("Authorization", "Bearer token-abc");

    expect(res.status).toBe(200);
  });

  it("still exempts a bearer request that carries unrelated cookies", async () => {
    getAuth.mockReturnValue({ userId: "user_native" });

    const res = await request(buildApp())
      .post("/api/v1/thing")
      .set("Authorization", "Bearer token-abc")
      .set("Cookie", "theme=dark; __client_uat=0")
      .send({});

    expect(res.status).toBe(200);
  });

  it("rejects a cookie-only mutation without a CSRF token", async () => {
    getAuth.mockReturnValue({ userId: "user_web" });

    const res = await request(buildApp()).post("/api/v1/thing").set("Cookie", "__session=jwt").send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EBADCSRFTOKEN");
  });

  it.each(["__session=jwt", "__session_Abc-123=jwt"])(
    "keeps the CSRF check when a Clerk session cookie (%s) rides along with the bearer header",
    async (cookie) => {
      getAuth.mockReturnValue({ userId: "user_web" });

      const res = await request(buildApp())
        .post("/api/v1/thing")
        .set("Authorization", "Bearer token-abc")
        .set("Cookie", cookie)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EBADCSRFTOKEN");
    },
  );

  it("answers 401, not a CSRF error, when Clerk rejects the bearer token", async () => {
    getAuth.mockReturnValue({ userId: null });

    const res = await request(buildApp()).post("/api/v1/thing").set("Authorization", "Bearer expired").send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("exempts nothing when Clerk middleware is not installed (dev auth bypass)", async () => {
    getAuth.mockImplementation(CLERK_NOT_INSTALLED);

    const res = await request(buildApp()).post("/api/v1/thing").set("Authorization", "Bearer anything").send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EBADCSRFTOKEN");
  });

  it("treats a non-Bearer Authorization scheme like no header at all", async () => {
    getAuth.mockReturnValue({ userId: "user_native" });

    const res = await request(buildApp()).post("/api/v1/thing").set("Authorization", "Basic dXNlcjpwYXNz").send({});

    expect(res.status).toBe(403);
  });

  it("leaves safe methods alone, even with a token Clerk rejects", async () => {
    getAuth.mockReturnValue({ userId: null });

    const res = await request(buildApp()).get("/api/v1/thing").set("Authorization", "Bearer expired");

    expect(res.status).toBe(200);
  });

  it("still accepts the web app's cookie + x-csrf-token round trip", async () => {
    getAuth.mockReturnValue({ userId: null });
    const agent = request.agent(buildApp());

    const tokenRes = await agent.get("/api/v1/csrf-token");
    const res = await agent.post("/api/v1/thing").set("x-csrf-token", tokenRes.body.csrfToken).send({});

    expect(res.status).toBe(200);
  });
});

describe("bearerAuthState", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  beforeEach(() => {
    getAuth.mockReset();
  });

  it("is none without an Authorization header, without consulting Clerk", () => {
    expect(bearerAuthState(req({}))).toBe("none");
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("is none for an empty bearer value", () => {
    expect(bearerAuthState(req({ authorization: "Bearer " }))).toBe("none");
  });

  it("matches the scheme case-insensitively", () => {
    getAuth.mockReturnValue({ userId: "u1" });
    expect(bearerAuthState(req({ authorization: "bearer abc" }))).toBe("authenticated");
  });

  it("does not mistake a cookie whose name merely starts with __session for Clerk's", () => {
    getAuth.mockReturnValue({ userId: "u1" });
    expect(bearerAuthState(req({ authorization: "Bearer abc", cookie: "__sessionx=1" }))).toBe("authenticated");
  });
});
