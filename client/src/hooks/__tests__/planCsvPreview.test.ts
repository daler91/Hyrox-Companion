import { describe, expect, it } from "vitest";

import { parseCsvRecords, parsePlanCsvPreview, PLAN_CSV_PREVIEW_ROWS } from "../planCsvPreview";

const HEADER = "Week,Day,Focus,Main Workout,Notes";

describe("parseCsvRecords", () => {
  it("keeps commas, quotes and line breaks inside quoted fields", () => {
    const text = 'a,"b, c","say ""go""","line one\nline two"\r\nd,e,f,g';
    expect(parseCsvRecords(text)).toEqual([
      ["a", "b, c", 'say "go"', "line one\nline two"],
      ["d", "e", "f", "g"],
    ]);
  });

  it("drops blank lines, a trailing newline among them", () => {
    expect(parseCsvRecords("a,b\n\n  \nc,d\n,,\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a quote inside an unquoted field as written", () => {
    expect(parseCsvRecords("5'10\" box jump,x")).toEqual([["5'10\" box jump", "x"]]);
  });

  it("opens a quoted field after spaces, and trims around it", () => {
    expect(parseCsvRecords('a,  "b, c"  ,d')).toEqual([["a", "b, c", "d"]]);
  });
});

// CL49 (CODEBASE_ANALYSIS_2026-10-03): the preview split rows on raw commas,
// counted a trailing newline as a workout, and keyed rows by week and day.
describe("parsePlanCsvPreview", () => {
  it("reads a quoted workout with commas into the right columns", () => {
    const csv = `${HEADER}\n1,Monday,Strength,"Back squat 5x5, then 3x10 lunges",Easy`;
    expect(parsePlanCsvPreview(csv)).toEqual({
      rows: [
        {
          rowNumber: 1,
          weekNumber: 1,
          dayName: "Monday",
          focus: "Strength",
          mainWorkout: "Back squat 5x5, then 3x10 lunges",
        },
      ],
      remainingRows: 0,
    });
  });

  it("gives two sessions on the same day distinct row numbers", () => {
    const csv = `${HEADER}\n1,Monday,Run,5 km easy,\n1,Monday,Strength,Wall balls,\n`;
    const { rows } = parsePlanCsvPreview(csv);
    expect(rows.map((row) => row.rowNumber)).toEqual([1, 2]);
  });

  it("counts only the data rows past the preview, ignoring a trailing newline", () => {
    const lines = Array.from({ length: 12 }, (_unused, week) => `${week + 1},Monday,Run,5 km,`);
    const csv = `${[HEADER, ...lines].join("\n")}\n\n`;
    const preview = parsePlanCsvPreview(csv);
    expect(preview.rows).toHaveLength(PLAN_CSV_PREVIEW_ROWS);
    expect(preview.remainingRows).toBe(2);
  });

  it("shows nothing more for a file that fits the preview", () => {
    const csv = `${HEADER}\n1,Monday,Run,5 km,\n`;
    expect(parsePlanCsvPreview(csv).remainingRows).toBe(0);
  });

  it("skips short rows but still numbers rows by their place in the file", () => {
    const csv = `${HEADER}\n1,Monday\n1,Tuesday,Run,5 km,`;
    expect(parsePlanCsvPreview(csv).rows).toEqual([
      { rowNumber: 2, weekNumber: 1, dayName: "Tuesday", focus: "Run", mainWorkout: "5 km" },
    ]);
  });

  it("has no rows without a data row", () => {
    expect(parsePlanCsvPreview(HEADER)).toEqual({ rows: [], remainingRows: 0 });
    expect(parsePlanCsvPreview("")).toEqual({ rows: [], remainingRows: 0 });
  });

  it("leaves a column the header lacks empty", () => {
    const csv = "Week,Day,Description,Notes\n2,Friday,Row 2 km,x";
    expect(parsePlanCsvPreview(csv).rows).toEqual([
      { rowNumber: 1, weekNumber: 2, dayName: "Friday", focus: "", mainWorkout: "" },
    ]);
  });
});
