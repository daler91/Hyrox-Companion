/**
 * shared/notifyHours.ts, ported to mobile/core/.../core/notifications/NotifyHours.kt.
 *
 * Each email kind against the default hour and its own override, each valid,
 * absent, null, fractional, negative or past 23. "Briefs tomorrow" is
 * `resolveNotifyHour(…, "todaySession") >= BRIEF_TOMORROW_FROM_HOUR`, pinned by
 * the todaySession cases at 11 and 12 and by `notifyHours.constants`.
 */
import {
  BRIEF_TOMORROW_FROM_HOUR,
  DEFAULT_NOTIFY_HOUR,
  EMAIL_NOTIFY_KINDS,
  type EmailNotifyKind,
  fallbackNotifyHour,
  isValidNotifyHour,
  NOTIFY_HOUR_FIELD,
  type NotifyHourPreferences,
  resolveNotifyHour,
} from "@shared/notifyHours";
import { WEEKLY_REVIEW_SUNDAY_EVENING_HOUR } from "@shared/weeklyReview";

import { suite } from "../types";

/** Preferences every kind is resolved against. */
const SHARED_PREFS: NotifyHourPreferences[] = [
  // docs/mobile-shared-logic.md.
  {},
  { notifyHour: 6 },
  { notifyHour: 24 },
  { notifyHour: 6.5 },
  { notifyHour: null },
  { notifyHourTodaySession: 0 },
  { notifyHourTodaySession: null, notifyHour: 13 },
  { notifyHourWeeklyReviewReminder: 9 },
  // The default hour at its bounds, either side of them, and not finite.
  { notifyHour: 0 },
  { notifyHour: 23 },
  { notifyHour: -1 },
  { notifyHour: 11 },
  { notifyHour: 12 },
  { notifyHour: Number.NaN },
  { notifyHour: Number.POSITIVE_INFINITY },
];

/** Override values tried on each kind's own field, with and without a default hour. */
const OVERRIDES = [0, 11, 12, 23, 24, -1, 23.5, null];

const RESOLVE_CASES = EMAIL_NOTIFY_KINDS.flatMap((kind) => [
  ...SHARED_PREFS.map((prefs) => ({ prefs, kind })),
  ...OVERRIDES.flatMap((hour) => [
    { prefs: { [NOTIFY_HOUR_FIELD[kind]]: hour }, kind },
    { prefs: { [NOTIFY_HOUR_FIELD[kind]]: hour, notifyHour: 9 }, kind },
  ]),
]);

/** `notifyHour` undefined (key left out), null, valid, invalid. */
const FALLBACK_HOURS: (number | null | undefined)[] = [undefined, null, 0, 6, 23, 24, -1, 6.5, Number.NaN];

export const notifyHoursSuites = [
  suite({
    name: "notifyHours.constants",
    description: "The default hour, the briefs-tomorrow threshold, the review reminder's hour and the kinds' fields.",
    run: () => ({
      DEFAULT_NOTIFY_HOUR,
      BRIEF_TOMORROW_FROM_HOUR,
      WEEKLY_REVIEW_SUNDAY_EVENING_HOUR,
      EMAIL_NOTIFY_KINDS,
      NOTIFY_HOUR_FIELD,
    }),
    cases: [null],
  }),
  suite({
    name: "notifyHours.isValidNotifyHour",
    description: "True only for a number that is a whole hour from 0 to 23.",
    run: (hour: unknown) => isValidNotifyHour(hour),
    cases: [
      "7",
      "",
      -1,
      0,
      1,
      7,
      23,
      24,
      23.5,
      6.5,
      0.5,
      -0.5,
      1e21,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      null,
      true,
      false,
      [7],
      { hour: 7 },
    ],
  }),
  suite({
    name: "notifyHours.fallbackNotifyHour",
    description: "The review reminder's Sunday-evening hour, else a valid default hour, else DEFAULT_NOTIFY_HOUR.",
    run: ({ kind, notifyHour }: { kind: EmailNotifyKind; notifyHour?: number | null }) =>
      fallbackNotifyHour(kind, notifyHour),
    cases: EMAIL_NOTIFY_KINDS.flatMap((kind) =>
      FALLBACK_HOURS.map((notifyHour) => (notifyHour === undefined ? { kind } : { kind, notifyHour })),
    ),
  }),
  suite({
    name: "notifyHours.resolveNotifyHour",
    description: "A kind's own valid hour, else its fallback.",
    run: ({ prefs, kind }: { prefs: NotifyHourPreferences; kind: EmailNotifyKind }) => resolveNotifyHour(prefs, kind),
    cases: RESOLVE_CASES,
  }),
];
