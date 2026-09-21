import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUnsubscribeToken } from "../../emailUnsubscribeToken";
import { storage } from "../../storage";
import { registerEmailUnsubscribeRoutes } from "../emailUnsubscribe";
import { resetRouteTestState, setupTestErrorHandler } from "./testUtils";

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    users: ["disableEmailNotifications"],
  }),
);

vi.mock("../../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const PATH = "/api/v1/emails/unsubscribe";

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  registerEmailUnsubscribeRoutes(app);
  setupTestErrorHandler(app);
  return app;
}

describe("email unsubscribe routes", () => {
  let app: express.Express;
  const token = createUnsubscribeToken("user_42");

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    app = buildApp();
  });

  describe("GET", () => {
    it("shows a confirm form for a valid token and never touches storage", async () => {
      const response = await request(app).get(`${PATH}?token=${encodeURIComponent(token)}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/html/);
      expect(response.text).toContain('<form method="post"');
      expect(response.text).toContain(`action="${PATH}?token=${encodeURIComponent(token)}"`);
      expect(storage.users.disableEmailNotifications).not.toHaveBeenCalled();
    });

    it("rejects a bad token with a 400 page", async () => {
      const response = await request(app).get(`${PATH}?token=not-a-token`);

      expect(response.status).toBe(400);
      expect(response.text).toContain("no longer valid");
      expect(response.text).toContain("/settings");
      expect(storage.users.disableEmailNotifications).not.toHaveBeenCalled();
    });

    it("rejects a missing token", async () => {
      const response = await request(app).get(PATH);
      expect(response.status).toBe(400);
    });
  });

  describe("POST", () => {
    it("turns email off for an RFC 8058 one-click post", async () => {
      vi.mocked(storage.users.disableEmailNotifications).mockResolvedValueOnce(true);

      const response = await request(app)
        .post(`${PATH}?token=${encodeURIComponent(token)}`)
        .type("form")
        .send("List-Unsubscribe=One-Click");

      expect(response.status).toBe(200);
      expect(response.text).toContain("unsubscribed");
      expect(storage.users.disableEmailNotifications).toHaveBeenCalledWith("user_42");
    });

    it("turns email off for the confirm page's form post", async () => {
      vi.mocked(storage.users.disableEmailNotifications).mockResolvedValueOnce(true);

      const response = await request(app).post(`${PATH}?token=${encodeURIComponent(token)}`);

      expect(response.status).toBe(200);
      expect(storage.users.disableEmailNotifications).toHaveBeenCalledWith("user_42");
    });

    it("rejects a bad token without touching storage", async () => {
      const response = await request(app).post(`${PATH}?token=bogus`);

      expect(response.status).toBe(400);
      expect(storage.users.disableEmailNotifications).not.toHaveBeenCalled();
    });

    it("answers 200 when the account no longer exists", async () => {
      vi.mocked(storage.users.disableEmailNotifications).mockResolvedValueOnce(false);

      const response = await request(app).post(`${PATH}?token=${encodeURIComponent(token)}`);

      expect(response.status).toBe(200);
      expect(response.text).toContain("no longer valid");
    });
  });
});
