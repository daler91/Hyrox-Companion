import type { AthleteFact } from "@shared/schema";
import type express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import athleteFactsRouter from "../athleteFacts";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", () => ({
  storage: {
    athleteFacts: {
      list: vi.fn(),
      add: vi.fn(),
      seed: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
      updateUserPreferences: vi.fn(),
    },
    idempotency: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

const FACTS = "/api/v1/athlete-facts";

function fact(overrides: Partial<AthleteFact> = {}): AthleteFact {
  return {
    id: "fact-1",
    userId: "test_user_id",
    fact: "No sled at my gym",
    dedupeKey: "no sled at my gym",
    category: "equipment",
    source: "athlete",
    active: true,
    reviewOn: "2026-12-30",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

describe("athlete facts routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    clearRateLimitBuckets();
    app = createTestApp(athleteFactsRouter);
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC" } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the athlete's facts", async () => {
    vi.mocked(storage.athleteFacts.list).mockResolvedValue([fact()]);

    const response = await request(app).get(FACTS);

    expect(response.status).toBe(200);
    expect(storage.athleteFacts.list).toHaveBeenCalledWith("test_user_id");
    expect(response.body[0]).toMatchObject({ fact: "No sled at my gym", reviewOn: "2026-12-30" });
  });

  it("adds a fact the athlete typed, due for review in 90 days on their calendar", async () => {
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: true, fact: fact(), created: true });

    const response = await request(app).post(FACTS).send({ fact: "  No sled at my gym ", category: "equipment" });

    expect(response.status).toBe(201);
    expect(storage.athleteFacts.add).toHaveBeenCalledWith(
      "test_user_id",
      { fact: "No sled at my gym", category: "equipment", source: "athlete" },
      "2026-12-30",
    );
  });

  it("answers 200 when the fact was already on the card, and keeps a chat-proposed fact's source", async () => {
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: true, fact: fact({ source: "chat" }), created: false });

    const response = await request(app).post(FACTS).send({ fact: "No sled at my gym", category: "equipment", source: "chat" });

    expect(response.status).toBe(200);
    expect(vi.mocked(storage.athleteFacts.add).mock.calls[0][1]).toMatchObject({ source: "chat" });
  });

  it("refuses a fact past the active cap, or too long, or with a source only the server writes", async () => {
    vi.mocked(storage.athleteFacts.add).mockResolvedValue({ ok: false, reason: "limit" });

    const full = await request(app).post(FACTS).send({ fact: "Bad left knee", category: "constraint" });
    const long = await request(app).post(FACTS).send({ fact: "x".repeat(141), category: "constraint" });
    const seeded = await request(app).post(FACTS).send({ fact: "Bad left knee", category: "constraint", source: "plan_generation" });

    expect(full.status).toBe(409);
    expect(full.body.code).toBe("ATHLETE_FACT_LIMIT");
    expect(long.status).toBe(400);
    expect(seeded.status).toBe(400);
    expect(storage.athleteFacts.add).toHaveBeenCalledTimes(1);
  });

  it("confirms a fact still true, and restores a retired one, moving the review date out", async () => {
    vi.mocked(storage.athleteFacts.update).mockResolvedValue({ ok: true, fact: fact(), created: false });

    await request(app).patch(`${FACTS}/fact-1`).send({ confirm: true });
    await request(app).patch(`${FACTS}/fact-1`).send({ active: true });
    await request(app).patch(`${FACTS}/fact-1`).send({ active: false });

    expect(vi.mocked(storage.athleteFacts.update).mock.calls.map(([, , patch]) => patch.reviewOn)).toEqual([
      "2026-12-30",
      "2026-12-30",
      undefined,
    ]);
  });

  it("refuses an edit that says what another fact already says, and an empty one", async () => {
    vi.mocked(storage.athleteFacts.update).mockResolvedValue({ ok: false, reason: "duplicate" });

    const clash = await request(app).patch(`${FACTS}/fact-1`).send({ fact: "Bad left knee" });
    const empty = await request(app).patch(`${FACTS}/fact-1`).send({});

    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("ATHLETE_FACT_DUPLICATE");
    expect(empty.status).toBe(400);
  });

  it("finds nothing to change or delete outside the athlete's own facts", async () => {
    vi.mocked(storage.athleteFacts.update).mockResolvedValue({ ok: false, reason: "not_found" });
    vi.mocked(storage.athleteFacts.delete).mockResolvedValue(false);

    expect((await request(app).patch(`${FACTS}/other`).send({ active: false })).status).toBe(404);
    expect((await request(app).delete(`${FACTS}/other`)).status).toBe(404);
  });

  describe("importing the older free-text note", () => {
    it("moves it into the card a fact per sentence, then clears it", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue({
        userTimezone: "UTC",
        trainingConstraints: "Bad left knee. No sled at my gym.",
      } as never);
      vi.mocked(storage.athleteFacts.seed).mockResolvedValue({ added: 2, skipped: 0 });

      const response = await request(app).post(`${FACTS}/import`).send({});

      expect(response.body).toEqual({ added: 2, skipped: 0 });
      expect(storage.athleteFacts.seed).toHaveBeenCalledWith(
        "test_user_id",
        [
          { fact: "Bad left knee.", category: "constraint", source: "plan_generation" },
          { fact: "No sled at my gym.", category: "constraint", source: "plan_generation" },
        ],
        "2026-12-30",
      );
      expect(storage.users.updateUserPreferences).toHaveBeenCalledWith("test_user_id", { trainingConstraints: null });
    });

    it("keeps the note while some of it doesn't fit, so nothing is lost", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue({ trainingConstraints: "Bad left knee." } as never);
      vi.mocked(storage.athleteFacts.seed).mockResolvedValue({ added: 0, skipped: 1 });

      const response = await request(app).post(`${FACTS}/import`).send({});

      expect(response.body).toEqual({ added: 0, skipped: 1 });
      expect(storage.users.updateUserPreferences).not.toHaveBeenCalled();
    });

    it("does nothing without a note", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValue({ trainingConstraints: null } as never);

      const response = await request(app).post(`${FACTS}/import`).send({});

      expect(response.body).toEqual({ added: 0, skipped: 0 });
      expect(storage.athleteFacts.seed).not.toHaveBeenCalled();
    });
  });
});
