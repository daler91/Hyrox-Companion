import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({ db: {} }));

import {
  demotionSportFor,
  type DeviceImportRow,
  formatBackfillRecord,
  importedBeforeStamping,
  parseBackfillRecord,
  revertPathFrom,
  STAMPED_AT_SYNC_SINCE,
} from "./backfill-counts-as-training";

/**
 * D5 (CODEBASE_ANALYSIS_2026-10-03): the 0094 backfill selected every device-id
 * row still counting and demoted the deny-list sports, so a manual log linked
 * to a Strava walk, a plan day's recovery walk and an import the athlete had
 * switched back on all dropped out of Total Workouts, with no record to undo
 * it. The earlier fixtures were all bare standalone imports; these are not.
 */

/** A standalone Strava walk imported before stamping shipped — the row the backfill exists for. */
function walkImport(overrides: Partial<DeviceImportRow> = {}): DeviceImportRow {
  return {
    id: "log-1",
    date: "2026-08-20",
    focus: "Walk",
    source: "strava",
    planDayId: null,
    deviceLinkSource: null,
    deviceActivity: {
      raw: { sport_type: "Walk", type: "Walk" },
      linkedAt: "2026-09-08T06:00:00.000Z",
    },
    ...overrides,
  };
}

describe("demotionSportFor", () => {
  it("demotes an untouched standalone walk imported before the sync stamped the column", () => {
    expect(demotionSportFor(walkImport())).toBe("Walk");
  });

  it("demotes a pre-snapshot Strava import and a Garmin one by their activity date", () => {
    expect(demotionSportFor(walkImport({ deviceActivity: null }))).toBe("Walk");
    expect(
      demotionSportFor(walkImport({ source: "garmin", focus: "walking", deviceActivity: null })),
    ).toBe("walking");
  });

  it.each<[string, Partial<DeviceImportRow>]>([
    ["a manual log a recording was linked to", { source: "manual", deviceLinkSource: "manual" }],
    ["a manual log the sync enriched", { source: "manual", deviceLinkSource: "auto" }],
    ["a plan day's recovery walk", { planDayId: "pd-1", deviceLinkSource: "auto" }],
    ["an import the athlete moved onto a plan day", { planDayId: "pd-1" }],
    ["an import the athlete adopted as their own log", { source: "manual" }],
    [
      "an import stamped at sync and switched back on by the athlete",
      { deviceActivity: { raw: { sport_type: "Walk" }, linkedAt: "2026-09-20T07:00:00.000Z" } },
    ],
    [
      "a Garmin session dated after stamping shipped",
      { source: "garmin", date: "2026-09-15", deviceActivity: null },
    ],
    [
      "a snapshot whose import instant cannot be read",
      { deviceActivity: { raw: { sport_type: "Walk" }, linkedAt: "soon" } },
    ],
    [
      "a training sport",
      {
        focus: "Run",
        deviceActivity: { raw: { sport_type: "Run" }, linkedAt: "2026-09-08T06:00:00.000Z" },
      },
    ],
  ])("leaves alone %s", (_label, overrides) => {
    expect(demotionSportFor(walkImport(overrides))).toBeNull();
  });
});

describe("importedBeforeStamping", () => {
  it("reads the snapshot's import instant, to the second", () => {
    expect(
      importedBeforeStamping(
        walkImport({ deviceActivity: { linkedAt: "2026-09-12T18:22:36.000Z" } }),
      ),
    ).toBe(true);
    expect(
      importedBeforeStamping(walkImport({ deviceActivity: { linkedAt: STAMPED_AT_SYNC_SINCE } })),
    ).toBe(false);
  });

  it("falls back to the activity date, counting the release day as after", () => {
    expect(importedBeforeStamping(walkImport({ date: "2026-09-11", deviceActivity: null }))).toBe(
      true,
    );
    expect(importedBeforeStamping(walkImport({ date: "2026-09-12", deviceActivity: null }))).toBe(
      false,
    );
  });
});

describe("the record that makes --apply reversible", () => {
  it("round-trips every id it flips", () => {
    const text = formatBackfillRecord(
      ["log-1", "log-2"],
      "user-1",
      new Date("2026-10-04T12:00:00Z"),
    );

    expect(JSON.parse(text)).toMatchObject({
      createdAt: "2026-10-04T12:00:00.000Z",
      userId: "user-1",
    });
    expect(parseBackfillRecord(text)).toEqual(["log-1", "log-2"]);
  });

  it.each([
    ["another script's report", JSON.stringify({ kind: "legacy-units", ids: ["log-1"] })],
    ["ids that are not strings", JSON.stringify({ kind: "counts-as-training-backfill", ids: [1] })],
    ["something that is not an object", "[]"],
  ])("refuses %s", (_label, text) => {
    expect(() => parseBackfillRecord(text)).toThrow(/record/);
  });

  it("reads --revert's file and refuses the flag without one", () => {
    expect(revertPathFrom(["--revert", "rec.json", "--apply"])).toBe("rec.json");
    expect(revertPathFrom(["--apply"])).toBeUndefined();
    expect(() => revertPathFrom(["--revert"])).toThrow(/--revert needs/);
    expect(() => revertPathFrom(["--revert", "--apply"])).toThrow(/--revert needs/);
  });
});
