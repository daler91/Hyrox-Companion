/**
 * The exercise catalogue's lookups (shared/schema/exercises.ts) and the
 * implement table (shared/exerciseEquipment.ts), ported to
 * mobile/core/.../exercises. Cases are generated from the tables themselves,
 * so a new exercise or alias is covered as soon as it is added.
 */
import {
  EXERCISE_EQUIPMENT,
  IMPLEMENT_OVERRIDES,
  implementFor,
  loadIncrement,
} from "@shared/exerciseEquipment";
import {
  EXERCISE_DEFINITIONS,
  EXERCISE_NAME_ALIASES,
  isRunningExerciseName,
  knownExerciseLabel,
  normalizeExerciseName,
} from "@shared/schema/exercises";

import { suite } from "../types";

const NAMES = Object.keys(EXERCISE_DEFINITIONS);
const ALIASES = Object.keys(EXERCISE_NAME_ALIASES);
const LABELS = Object.values(EXERCISE_DEFINITIONS).map((definition) => definition.label);

/** Names inherited from Object.prototype: the tables are plain objects, and two lookups see these. */
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);

/** Every character JS `trim()` strips, and the ones Kotlin's `trim()` treats differently. */
const JS_WHITESPACE = [
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  "　",
  "﻿",
];
const KOTLIN_ONLY_WHITESPACE = ["\u001c", "\u001d", "\u001e", "\u001f", "\u0085", "᠎", "​"];

/** Non-ASCII characters whose JS lowercase holds an ASCII letter, digit or apostrophe. */
function lowercasesToSlugChars(): string[] {
  const found: string[] = [];
  for (let cp = 0x80; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const char = String.fromCodePoint(cp);
    if (/[a-z0-9']/.test(char.toLowerCase())) found.push(char);
  }
  return found;
}

/** Spellings of a catalogue entry a person or an AI parse might produce. */
function variants(key: string): string[] {
  const words = key.split("_");
  const spaced = words.join(" ");
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return [key, `  ${title.toUpperCase()}  `, words.join("-"), `${spaced}s`, `'${title}'!`];
}

const MESSY = [
  "back-squat",
  "BACK  SQUAT",
  "Back Squat",
  "back_squat",
  "__back__squat__",
  "Farmer's Carry",
  "farmer’s carry",
  "farmer‘s carry",
  "farmer`s carry",
  "farmers' carry",
  "farmer ' s carry",
  "'back squat'",
  "back'squat",
  "back 'squat",
  "Ski-Erg",
  "  SkiErg ",
  "Ski Erg",
  " back squat",
  "﻿back squat",
  "\u001fback squat",
  "back\tsquat\n",
  "back squat",
  "back​squat",
  "back 💪 squat",
  "back💪squat",
  "💪",
  "\ud800back squat",
  "back squat\udc00",
  "Café Run",
  "café",
  "café run",
  "İnterval run",
  "İ",
  "Kettlebell swings",
  "KK",
  "ＢＡＣＫ ＳＱＵＡＴ",
  "Σquat",
  "ΣΑΣ run",
  "run ٣",
  "5k run",
  "Run 1K",
  "run-1k",
  "1k run",
  "custom",
  "Custom",
  "",
  "   ",
  "!!!",
  "_",
  "'",
  "’’’",
  "a",
  "x".repeat(300),
  "back squats",
  "Pull Ups",
  "pull-ups",
  "Push-ups",
  "push ups",
  "RDL",
  "rdls",
  "KB Swings",
  "Wall-Balls",
  "wallballs",
  "running",
  "Running!",
  "jogging",
  "not a real exercise",
  "Constructor",
  "CONSTRUCTOR!",
  "con structor",
  "__proto__",
  "proto",
  "to_string",
  "tostring",
  "hasownproperty",
  "valueof",
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const NORMALIZE_CASES = unique([
  ...NAMES.flatMap(variants),
  ...ALIASES.flatMap(variants),
  ...LABELS,
  ...LABELS.map((label) => label.toUpperCase()),
  ...MESSY,
  ...PROTOTYPE_KEYS,
  ...lowercasesToSlugChars().flatMap((char) => [
    char,
    `${char} run`,
    `run${char}`,
    `back ${char} squat`,
  ]),
  ...[...JS_WHITESPACE, ...KOTLIN_ONLY_WHITESPACE].flatMap((ws) => [
    `${ws}back squat${ws}`,
    `back${ws}squat`,
    ws,
  ]),
]);

const RUNNING_CASES = unique([
  ...NAMES,
  ...ALIASES,
  ...LABELS,
  "Easy Run",
  "run",
  "rowing",
  "",
  "jogging",
  "Running",
  "RUNS",
  "trail-run",
  "İnterval run",
  "Run 1K",
  ...PROTOTYPE_KEYS,
]);

const LABEL_CASES = unique([
  ...NAMES,
  ...ALIASES,
  ...LABELS,
  "back_squat",
  "Back Squat",
  "BACK_SQUAT",
  " back_squat",
  "custom",
  "",
  "not_a_real_exercise",
  ...PROTOTYPE_KEYS,
]);

const IMPLEMENT_CASES = unique([
  ...NAMES,
  ...Object.keys(EXERCISE_EQUIPMENT),
  ...Object.keys(IMPLEMENT_OVERRIDES),
  ...ALIASES.slice(0, 20),
  "Back Squat",
  "BACK_SQUAT",
  "",
  "not_a_real_exercise",
  "barbell",
  ...PROTOTYPE_KEYS,
]);

export const exercisesSuites = [
  suite({
    name: "exercises.normalizeExerciseName",
    description:
      "normalizeExerciseName over every name, alias and label in many spellings, messy text, unicode case and whitespace, and names inherited from Object.prototype.",
    run: (raw: string) => normalizeExerciseName(raw),
    cases: NORMALIZE_CASES,
  }),
  suite({
    name: "exercises.isRunningExerciseName",
    description:
      "isRunningExerciseName over every name, alias and label, and a few free-text names.",
    run: (name: string) => isRunningExerciseName(name),
    cases: RUNNING_CASES,
  }),
  suite({
    name: "exercises.knownExerciseLabel",
    description: "knownExerciseLabel (exact canonical keys only; undefined is written as null).",
    run: (name: string) => knownExerciseLabel(name) ?? null,
    cases: LABEL_CASES,
  }),
  suite({
    name: "exercises.implementFor",
    description:
      "implementFor over every catalogue name and table key. Null where the TypeScript returns a non-implement (a name inherited from Object.prototype).",
    run: (name: string) => {
      const implement: unknown = implementFor(name);
      return typeof implement === "string" ? implement : null;
    },
    cases: IMPLEMENT_CASES,
  }),
  suite({
    name: "exercises.loadIncrement",
    description:
      'loadIncrement over every catalogue name in kg and lbs, and units other than "kg" (all pounds).',
    run: ([name, unit]: [string, string]) => loadIncrement(name, unit as "kg" | "lbs"),
    cases: [
      ...IMPLEMENT_CASES.flatMap((name) => [
        [name, "kg"] as [string, string],
        [name, "lbs"] as [string, string],
      ]),
      ...["back_squat", "goblet_squat", "kettlebell_swings", "leg_press", "pull_up"].flatMap(
        (name) => ["lb", "KG", "Kg", "", "kgs"].map((unit) => [name, unit] as [string, string]),
      ),
    ],
  }),
];
