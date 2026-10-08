import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getStartOfWeekString, getTodayString, getYesterdayString, toISODateString } from "./dateUtils";

/**
 * vitest.setup.ts pins TZ=UTC and most fixtures are UTC instants, so under the
 * rest of the suite a local day and a UTC day are the same day. A regression of
 * getTodayString to `toISOString().slice(0, 10)` would pass there while moving
 * a Los Angeles athlete's "today" row, "Jump to today" and completion stats to
 * tomorrow after 5 pm. These run the helpers in real non-UTC zones, on both
 * sides of UTC. A16 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Node applies a runtime change to process.env.TZ to Date at once, so each block
 * switches the zone for its own tests and puts UTC back afterwards.
 */
function inTimeZone(zone: string, run: () => void): void {
  describe(`in ${zone}`, () => {
    beforeAll(() => {
      process.env.TZ = zone;
    });
    afterAll(() => {
      process.env.TZ = "UTC";
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    run();
  });
}

function at(isoInstant: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoInstant));
}

describe("date helpers outside UTC (A16)", () => {
  inTimeZone("America/Los_Angeles", () => {
    it("is really running outside UTC", () => {
      // June: PDT, UTC-7. Guards against the zone switch silently not applying.
      expect(new Date("2026-06-15T01:30:00Z").getTimezoneOffset()).toBe(420);
    });

    it("keeps an evening's 'today' on the athlete's own date, not UTC's tomorrow", () => {
      at("2026-06-15T01:30:00Z"); // 18:30 on 14 June in Los Angeles
      expect(getTodayString()).toBe("2026-06-14");
      expect(getYesterdayString()).toBe("2026-06-13");
    });

    it("formats a local instant by its local calendar day", () => {
      expect(toISODateString(new Date("2026-06-15T06:59:00Z"))).toBe("2026-06-14");
      expect(toISODateString(new Date("2026-06-15T07:00:00Z"))).toBe("2026-06-15");
    });

    it("starts the week on the local Monday", () => {
      at("2026-06-15T05:00:00Z"); // Sunday 14 June, 22:00 local; Monday in UTC
      expect(getStartOfWeekString()).toBe("2026-06-08");
    });
  });

  inTimeZone("Pacific/Auckland", () => {
    it("is really running outside UTC", () => {
      // June: NZST, UTC+12.
      expect(new Date("2026-06-14T13:00:00Z").getTimezoneOffset()).toBe(-720);
    });

    it("moves 'today' forward with the athlete's morning, ahead of UTC", () => {
      at("2026-06-14T13:00:00Z"); // 01:00 on 15 June in Auckland
      expect(getTodayString()).toBe("2026-06-15");
      expect(getYesterdayString()).toBe("2026-06-14");
    });
  });
});
