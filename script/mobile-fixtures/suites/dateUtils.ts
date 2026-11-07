/**
 * shared/dateUtils.ts, ported to mobile/core/.../core/dates/DateUtils.kt.
 *
 * Every function goes through the private `toUtcEpoch`: `split("-")`, `Number`
 * on each part, then `Date.UTC(year, month - 1, day)`. So beyond real calendar
 * edges (month ends, leap days, year boundaries, the last day a Date holds),
 * the cases pin what that parse does with strings it was never meant to see:
 * the ones it tolerates (rolled-over days, padded or signed parts, whitespace,
 * hex, years 0–99 read as 19xx) and the ones it rejects (NaN, which surfaces as
 * NaN, "NaN-NaN-NaN", "Monday" or []).
 *
 * "Today" is always a parameter here (`nextPlanStartDate(today)`), so nothing
 * reads the clock.
 */
import {
  addDaysToISODate,
  computePlanWeeks,
  dayDiff,
  isIsoCalendarDate,
  MAX_PLAN_WEEKS,
  MIN_PLAN_WEEKS,
  nextPlanStartDate,
  PLAN_WEEKDAYS,
  planSpanWeeks,
  planWeekOneMonday,
  type PlanWeeksOptions,
  weekdayIndex,
  weekdayName,
  weekOneDaysBeforeStart,
} from "@shared/dateUtils";

import { suite } from "../types";

/** Monday 2026-11-09 through Sunday 2026-11-15: every weekday once. */
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

/** Real days at calendar edges. */
const CALENDAR_EDGES = [
  // Month ends.
  "2026-01-31",
  "2026-02-01",
  "2026-02-28",
  "2026-03-01",
  "2026-04-30",
  "2026-06-30",
  "2026-09-30",
  "2026-11-30",
  // A year boundary: 2026-12-31 is a Thursday, so the next start is 2027-01-04.
  "2026-12-28",
  "2026-12-30",
  "2026-12-31",
  "2027-01-01",
  "2027-01-03",
  "2027-01-04",
  // Leap days: 2024 and 2000 are leap years, 2025, 1900 and 2100 are not.
  "2024-02-28",
  "2024-02-29",
  "2024-03-01",
  "2025-02-28",
  "2025-03-01",
  "2000-02-29",
  "1900-02-28",
  "1900-03-01",
  "2100-02-28",
  "2100-03-01",
  // The epoch, years under 1000 (printed unpadded), five- and six-digit years
  // (toISOString writes them "+0YYYYY"), and the last day a Date can hold.
  "1970-01-01",
  "1969-12-31",
  "0100-01-01",
  "0100-03-01",
  "0999-12-31",
  "1000-01-01",
  "9999-12-31",
  "10000-01-01",
  "275760-09-13",
];

/** Strings the parse accepts as some day, often not the one written. */
const TOLERATED = [
  // Out-of-range parts roll over: 2025-02-29 is 1 March, month 0 is December.
  "2025-02-29",
  "2026-02-30",
  "2026-04-31",
  "2026-13-01",
  "2026-00-10",
  "2026-11-00",
  "2026-12-32",
  // Date.UTC reads the years 0–99 as 1900–1999.
  "0000-01-01",
  "0050-01-01",
  "0099-12-31",
  // Not YYYY-MM-DD, but each part is a number.
  "2026-1-5",
  "2026-011-05",
  "20266-11-15",
  "+2026-11-15",
  "2026-+11-+15",
  // Number() trims JS whitespace: ASCII, NBSP, BOM, ideographic space.
  " 2026-11-15",
  "2026-11-15 ",
  "\t2026-11-15\n",
  " 2026-11-15",
  "﻿2026-11-15",
  "　2026-11-15",
  // Extra parts are ignored; an empty part is 0; a leading "-" makes year "".
  "2026-11-15-01",
  "2026-11-09-garbage",
  "2026--01",
  "2026-11-",
  "-2026-01-01",
  // Fractions truncate; exponents, hex, octal and binary literals parse.
  "2026.9-11-15",
  "2026-11.9-15",
  "2026-11-15.9",
  "2026-11-15.",
  "2026-0.5-10",
  "1e3-01-01",
  ".5e4-01-01",
  "2026-11-1e1",
  "0x7EA-11-15",
  "0o3752-11-15",
  "0b11111101010-11-15",
];

/** Strings the parse rejects: some part is NaN, or the day is past what a Date holds. */
const REJECTED = [
  "",
  "abcd-ef-gh",
  "aaaa",
  "last-week",
  "15/11/2026",
  "2026",
  "2026-11",
  "2026-11-15T00:00",
  "2026-01-05T00:00:00Z",
  "2026-aa-01",
  "2026-11-15e",
  "2026-11-1 5",
  "2026-11-0x",
  "0x-01-01",
  "1_000-01-01",
  "Infinity-01-01",
  // U+180E stopped being whitespace in Unicode 6.3, and Number() does not trim it.
  "᠎2026-11-15",
  "275760-09-14",
  "300000-01-01",
];

const DATES = [...WEEK, ...CALENDAR_EDGES, ...TOLERATED, ...REJECTED];

/** The span suites' input: `planSpanWeeks(start, end, options?)`. */
type SpanInput = readonly [string, string] | readonly [string, string, PlanWeeksOptions];

const RACE = { endDateIsRaceDate: true } as const;

/** Day offsets for the span grid: both sides of zero, each weekday, the round(days / 7) steps and the 24-week cap. */
const SPAN_OFFSETS = [-10, -8, -7, -4, -3, -1, 0, 1, 3, 4, 6, 7, 10, 13, 52, 56, 59, 60, 69, 70, 164, 165, 167, 168, 171, 172, 175, 210, 365];

const SPAN_CASES: SpanInput[] = [
  // Every start weekday against every offset, rounded and as a race.
  ...WEEK.flatMap((start) =>
    SPAN_OFFSETS.flatMap((offset): SpanInput[] => {
      const end = addDaysToISODate(start, offset);
      return [
        [start, end],
        [start, end, RACE],
      ];
    }),
  ),
  // docs/mobile-shared-logic.md: a Wednesday start with a Saturday race, a
  // Monday start with a Thursday race in week 1, a race before the start.
  ["2026-11-11", "2026-11-21", RACE],
  ["2026-11-09", "2026-11-12", RACE],
  ["2026-11-12", "2026-11-09"],
  ["2026-11-12", "2026-11-09", RACE],
  // The options object omitted, empty and explicitly false read the same.
  ["2026-10-07", "2026-11-28"],
  ["2026-10-07", "2026-11-28", {}],
  ["2026-10-07", "2026-11-28", { endDateIsRaceDate: false }],
  ["2026-10-07", "2026-11-28", RACE],
  // Across a leap day and a year boundary.
  ["2024-02-26", "2024-03-25"],
  ["2024-02-26", "2024-03-25", RACE],
  ["2026-12-30", "2027-03-01"],
  ["2026-12-30", "2027-03-01", RACE],
  ["2026-01-01", "2027-01-01"],
  // Tolerated and rejected dates on either side.
  ["2026-02-30", "2026-03-30"],
  ["2026-02-30", "2026-03-30", RACE],
  [" 2026-11-09", "2026-12-07", RACE],
  ["0050-01-01", "1950-03-01"],
  ["garbage", "2026-11-09"],
  ["garbage", "2026-11-09", RACE],
  ["2026-11-09", "garbage"],
  ["2026-11-09", "garbage", RACE],
  ["", ""],
];

const DAY_DIFF_CASES: [string, string][] = [
  // docs/mobile-shared-logic.md.
  ["2026-03-28", "2026-03-30"],
  ["2026-10-31", "2026-11-02"],
  ["2026-01-01", "2025-12-31"],
  ["2024-02-28", "2024-03-01"],
  ["2100-02-28", "2100-03-01"],
  ["2026-11-09", "2026-11-09"],
  // US DST, month ends, leap and non-leap Februaries, year lengths.
  ["2026-03-01", "2026-03-29"],
  ["2026-01-31", "2026-02-28"],
  ["2026-01-31", "2026-03-01"],
  ["2025-02-28", "2025-03-01"],
  ["2000-02-28", "2000-03-01"],
  ["1900-02-28", "1900-03-01"],
  ["2026-12-31", "2027-01-01"],
  ["2026-01-01", "2027-01-01"],
  ["2024-01-01", "2025-01-01"],
  ["2027-01-01", "2026-01-01"],
  // Long spans, up to the Date range.
  ["1970-01-01", "2026-11-09"],
  ["0100-01-01", "9999-12-31"],
  ["1970-01-01", "275760-09-13"],
  ["275760-09-13", "1970-01-01"],
  // Every tolerated and rejected string, against a real day.
  ...[...TOLERATED, ...REJECTED].map((date): [string, string] => [date, "2026-11-09"]),
  ["2026-11-09", "garbage"],
  ["", ""],
];

const ADD_DAYS_CASES: [string, number][] = [
  // docs/mobile-shared-logic.md.
  ["2026-12-31", 1],
  ["2024-02-28", 1],
  ["2026-03-29", -1],
  // Leap days either way, month ends, a year boundary backwards.
  ["2024-02-28", 2],
  ["2024-03-01", -1],
  ["2025-02-28", 1],
  ["2025-03-01", -1],
  ["2000-02-28", 1],
  ["2100-02-28", 1],
  ["2027-01-01", -1],
  ["2026-01-31", 29],
  // Years under 1000 print unpadded; 0050 reads as 1950; years go negative.
  ["1000-01-01", -1],
  ["0100-01-01", -1],
  ["0100-01-01", -36525],
  ["0100-01-01", -40000],
  // The edges of the Date range: one day past either gives "NaN-NaN-NaN".
  ["1970-01-01", 100_000_000],
  ["1970-01-01", 100_000_001],
  ["1970-01-01", -100_000_000],
  ["1970-01-01", -100_000_001],
  ["2026-11-09", 2_147_483_647],
  ["2026-11-09", -2_147_483_648],
  // Every date as written (0 days), and real days stepped both ways.
  ...DATES.map((date): [string, number] => [date, 0]),
  ...[...WEEK, ...CALENDAR_EDGES].flatMap((date) =>
    [1, -1, 7, 28, 365, 3650, -400].map((days): [string, number] => [date, days]),
  ),
];

/** Formats taken from shared/dateUtils.test.ts, on top of DATES. */
const ISO_EXTRA = ["2026-10-04", "0999-01-01", "1900-02-29", "2026-13-45", "2026-01-05-01", "-2026-01-01", "+2026-01-01"];

export const dateUtilsSuites = [
  suite({
    name: "dateUtils.constants",
    description: "MIN_PLAN_WEEKS, MAX_PLAN_WEEKS and PLAN_WEEKDAYS (Monday first).",
    run: () => ({ MIN_PLAN_WEEKS, MAX_PLAN_WEEKS, PLAN_WEEKDAYS }),
    cases: [null],
  }),
  suite({
    name: "dateUtils.dayDiff",
    description: "Whole days from start to end in UTC; NaN when either date does not parse.",
    run: ([start, end]: [string, string]) => dayDiff(start, end),
    cases: DAY_DIFF_CASES,
  }),
  suite({
    name: "dateUtils.planSpanWeeks",
    description: "Plan weeks, unclamped: round(days / 7), or the Monday-anchored week of a race end date.",
    run: ([start, end, options]: SpanInput) => planSpanWeeks(start, end, options),
    cases: SPAN_CASES,
  }),
  suite({
    name: "dateUtils.computePlanWeeks",
    description: "planSpanWeeks clamped to [MIN_PLAN_WEEKS, MAX_PLAN_WEEKS]; NaN stays NaN.",
    run: ([start, end, options]: SpanInput) => computePlanWeeks(start, end, options),
    cases: SPAN_CASES,
  }),
  suite({
    name: "dateUtils.isIsoCalendarDate",
    description: "True only for a real day written YYYY-MM-DD with a year from 0100 to 9999.",
    run: (value: string) => isIsoCalendarDate(value),
    cases: [...new Set([...DATES, ...ISO_EXTRA])],
  }),
  suite({
    name: "dateUtils.addDaysToISODate",
    description: "Whole days added in UTC; years unpadded; \"NaN-NaN-NaN\" outside the Date range or for a bad date.",
    run: ([date, days]: [string, number]) => addDaysToISODate(date, days),
    cases: ADD_DAYS_CASES,
  }),
  suite({
    name: "dateUtils.weekdayIndex",
    description: "0 for Monday to 6 for Sunday; NaN for a date that does not parse.",
    run: (date: string) => weekdayIndex(date),
    cases: DATES,
  }),
  suite({
    name: "dateUtils.weekdayName",
    description: "The weekday's name; \"Monday\" for a date that does not parse.",
    run: (date: string) => weekdayName(date),
    cases: DATES,
  }),
  suite({
    name: "dateUtils.planWeekOneMonday",
    description: "The Monday on or before the start date, as addDaysToISODate prints it.",
    run: (date: string) => planWeekOneMonday(date),
    cases: DATES,
  }),
  suite({
    name: "dateUtils.weekOneDaysBeforeStart",
    description: "Week-1 day names before the start date; [] for a Monday or a date that does not parse.",
    run: (date: string) => weekOneDaysBeforeStart(date),
    cases: DATES,
  }),
  suite({
    name: "dateUtils.nextPlanStartDate",
    description: "The first Monday on or after today: today itself, unchanged, when it is a Monday.",
    run: (today: string) => nextPlanStartDate(today),
    cases: DATES,
  }),
];
