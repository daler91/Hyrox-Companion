import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: { select: vi.fn(), insert: vi.fn() },
}));

import { db } from "../db";
import { WeeklyReviewsStorage } from "./weeklyReviews";

describe("WeeklyReviewsStorage", () => {
  const storage = new WeeklyReviewsStorage();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIntents", () => {
    it("returns an empty map without querying when no weeks are requested", async () => {
      const result = await storage.getIntents("user-1", []);

      expect(result).toEqual(new Map());
      expect(db.select).not.toHaveBeenCalled();
    });

    it("maps each returned row to its week's intent", async () => {
      const whereMock = vi.fn().mockResolvedValue([
        { weekStart: "2026-06-01", intent: "run more" },
        { weekStart: "2026-06-08", intent: null },
      ]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as never); // NOSONAR partial Drizzle query-builder mock

      const result = await storage.getIntents("user-1", ["2026-06-01", "2026-06-08"]);

      expect(result).toEqual(
        new Map([
          ["2026-06-01", "run more"],
          ["2026-06-08", null],
        ]),
      );
    });

    it("leaves a week out of the map entirely when it has no saved row", async () => {
      const whereMock = vi.fn().mockResolvedValue([{ weekStart: "2026-06-01", intent: "run more" }]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock } as never); // NOSONAR partial Drizzle query-builder mock

      const result = await storage.getIntents("user-1", ["2026-06-01", "2026-06-08"]);

      expect(result.has("2026-06-01")).toBe(true);
      expect(result.has("2026-06-08")).toBe(false);
    });
  });

  describe("setIntent", () => {
    function mockInsert(savedRow: unknown) {
      const returningMock = vi.fn().mockResolvedValue([savedRow]);
      const onConflictDoUpdateMock = vi.fn().mockReturnValue({ returning: returningMock });
      const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
      vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never); // NOSONAR partial Drizzle query-builder mock
      return { valuesMock, onConflictDoUpdateMock };
    }

    it("upserts the intent and returns the saved row", async () => {
      const savedRow = {
        id: "wr-1",
        userId: "user-1",
        weekStart: "2026-06-01",
        intent: "three runs",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { valuesMock, onConflictDoUpdateMock } = mockInsert(savedRow);

      const result = await storage.setIntent("user-1", "2026-06-01", "three runs");

      expect(result).toEqual(savedRow);
      expect(valuesMock).toHaveBeenCalledWith({
        userId: "user-1",
        weekStart: "2026-06-01",
        intent: "three runs",
      });
      expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ set: expect.objectContaining({ intent: "three runs" }) }),
      );
    });

    it("clears the row's text instead of deleting it when the intent is blank", async () => {
      const savedRow = {
        id: "wr-1",
        userId: "user-1",
        weekStart: "2026-06-01",
        intent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { valuesMock } = mockInsert(savedRow);

      const result = await storage.setIntent("user-1", "2026-06-01", null);

      expect(result.intent).toBeNull();
      expect(valuesMock).toHaveBeenCalledWith({ userId: "user-1", weekStart: "2026-06-01", intent: null });
    });
  });
});
