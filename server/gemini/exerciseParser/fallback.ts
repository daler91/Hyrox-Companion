import { EXERCISE_DEFINITIONS, normalizeExerciseName } from "@shared/schema/exercises";

import { sanitizeLabel } from "./mapping";

const HEURISTIC_CHUNK_SPLIT_PATTERN = /[.;\n]+/;
const HEURISTIC_TIME_UNITS = ["minutes", "minute", "mins", "min"] as const;
const CONDITIONING_NAME_PATTERN = /(row|run|bike|ski|erg|amrap|emom|interval)/i;

interface HeuristicFallbackCandidate {
  name: string;
  sets: number;
  value: number;
  valueKind: "reps" | "time" | "distance" | "weight";
  distanceUnit?: string;
  weightUnit?: string;
}

interface HeuristicLead {
  name: string;
  body: string;
}

interface HeuristicSetExpression {
  sets: number;
  value: number;
  endIndex: number;
}

// Hyrox / erg movements whose common phrasing the shared exercise normalizer
// does not alias on its own — bare "run"/"row", spaced "ski erg", and a few
// singular/plural variants. Scoped to this fallback because these mappings are
// only safe to assume inside a functional-fitness workout paste.
const FALLBACK_EXERCISE_ALIASES: Record<string, string> = {
  run: "run_1k",
  runs: "run_1k",
  running: "run_1k",
  row: "rowing",
  rows: "rowing",
  ski: "skierg",
  ski_erg: "skierg",
  burpee_broad_jumps: "burpee_broad_jump",
  wall_ball: "wall_balls",
  sandbag_lunge: "sandbag_lunges",
  squat: "back_squat",
  squats: "back_squat",
};

function normalizeToken(label: string): string {
  // Collapse every run of non-alphanumerics to a single "_", then strip a lone
  // leading/trailing "_" with slices rather than an anchored `_+` regex — the
  // latter is polynomial-backtracking on attacker-controlled text (CodeQL).
  let token = label.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  if (token.startsWith("_")) token = token.slice(1);
  if (token.endsWith("_")) token = token.slice(0, -1);
  return token;
}

function canonicalExerciseName(label: string): string {
  const known = normalizeExerciseName(label);
  if (known) return known;

  return FALLBACK_EXERCISE_ALIASES[normalizeToken(label)] ?? "custom";
}

function categoryForExercise(exerciseName: string, rawName: string): string {
  const definition = (EXERCISE_DEFINITIONS as Record<string, { category: string } | undefined>)[exerciseName];
  if (definition) return definition.category;

  return CONDITIONING_NAME_PATTERN.test(rawName) ? "conditioning" : "strength";
}

function hasOnlyAsciiLettersAndSpaces(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code == null) return false;

    const isUppercaseLetter = code >= 65 && code <= 90;
    const isLowercaseLetter = code >= 97 && code <= 122;
    if (char !== " " && !isUppercaseLetter && !isLowercaseLetter) return false;
  }

  return true;
}

function parseHeuristicLead(chunk: string): HeuristicLead | null {
  const separatorIndex = chunk.indexOf(":");
  if (separatorIndex <= 0) return null;

  const name = chunk.slice(0, separatorIndex).trim();
  const body = chunk.slice(separatorIndex + 1).trimStart();
  if (!name || body.length === 0 || !hasOnlyAsciiLettersAndSpaces(name)) return null;

  return { name, body };
}

function isAsciiDigit(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.codePointAt(0);
  return code != null && code >= 48 && code <= 57;
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function skipWhitespace(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length && isWhitespace(value[cursor])) cursor++;
  return cursor;
}

function readPositiveInteger(value: string, index: number): { value: number; nextIndex: number } | null {
  let cursor = index;
  while (cursor < value.length && isAsciiDigit(value[cursor])) cursor++;
  if (cursor === index) return null;

  const parsed = Number.parseInt(value.slice(index, cursor), 10);
  return Number.isFinite(parsed) && parsed > 0 ? { value: parsed, nextIndex: cursor } : null;
}

function parseSetExpression(value: string, startIndex: number): HeuristicSetExpression | null {
  const sets = readPositiveInteger(value, startIndex);
  if (!sets) return null;

  let cursor = skipWhitespace(value, sets.nextIndex);
  if (value[cursor]?.toLowerCase() !== "x") return null;

  cursor = skipWhitespace(value, cursor + 1);
  const count = readPositiveInteger(value, cursor);
  if (!count) return null;

  return { sets: sets.value, value: count.value, endIndex: count.nextIndex };
}

function hasTimeUnitAt(value: string, index: number): boolean {
  const unitStart = skipWhitespace(value, index);
  const suffix = value.slice(unitStart).toLowerCase();
  return HEURISTIC_TIME_UNITS.some((unit) => suffix.startsWith(unit));
}

function parseNamedHeuristicChunk(body: string): HeuristicFallbackCandidate | null {
  for (let index = 1; index < body.length; index++) {
    if (!isAsciiDigit(body[index]) || !isWhitespace(body[index - 1])) continue;

    const name = body.slice(0, index).trim();
    if (!name || !hasOnlyAsciiLettersAndSpaces(name)) return null;

    const expression = parseSetExpression(body, index);
    if (!expression) continue;

    return {
      name,
      sets: expression.sets,
      value: expression.value,
      valueKind: hasTimeUnitAt(body, expression.endIndex) ? "time" : "reps",
    };
  }

  return null;
}

function parseLeadOnlyHeuristicChunk(
  lead: HeuristicLead | null,
  body: string,
): HeuristicFallbackCandidate | null {
  if (!lead) return null;

  const expression = parseSetExpression(body, 0);
  if (!expression) return null;

  return {
    name: lead.name,
    sets: expression.sets,
    value: expression.value,
    valueKind: hasTimeUnitAt(body, expression.endIndex) ? "time" : "reps",
  };
}

// A repeating-circuit / Hyrox paste lists one run or station per line (e.g.
// "1000m Run", "100 Wall Balls", "Sled Push 50m"), which the sets x reps parsers
// above cannot recognize. The helpers below parse that single-measurement shape.
const SINGLE_VALUE_LIST_MARKER_PATTERN = /^\s*(?:\d+[.):]|[-*•])\s+/;
// Linear, non-backtracking shapes (no overlapping `.`/`\s` quantifiers) so the
// parser stays O(n) on adversarial input. Measurement-first anchors the name to
// the first non-space after the gap; name-first locates the trailing
// measurement and the name is taken as the slice before it.
const MEASUREMENT_FIRST_PATTERN = /^(\d+(?:\.\d+)?)([a-zA-Z]*)\s+(\S.*)$/;
const NAME_FIRST_TAIL_PATTERN = /\s(\d+(?:\.\d+)?)([a-zA-Z]*)$/;
const MEASUREMENT_ONLY_PATTERN = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/;

const DISTANCE_UNIT_BY_TOKEN: Record<string, string> = {
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  km: "km", k: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  mi: "mi", mile: "mi", miles: "mi",
  ft: "ft", feet: "ft", foot: "ft",
};
const WEIGHT_UNIT_BY_TOKEN: Record<string, string> = {
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
};
const TIME_UNIT_TOKENS = new Set(["min", "mins", "minute", "minutes"]);

function classifyMeasurement(
  value: number,
  unitToken: string | undefined,
): Pick<HeuristicFallbackCandidate, "value" | "valueKind" | "distanceUnit" | "weightUnit"> {
  const unit = (unitToken ?? "").toLowerCase();

  const distanceUnit = DISTANCE_UNIT_BY_TOKEN[unit];
  if (distanceUnit) return { value, valueKind: "distance", distanceUnit };

  const weightUnit = WEIGHT_UNIT_BY_TOKEN[unit];
  if (weightUnit) return { value, valueKind: "weight", weightUnit };

  if (TIME_UNIT_TOKENS.has(unit)) return { value, valueKind: "time" };

  return { value, valueKind: "reps" };
}

function buildSingleValueCandidate(
  rawName: string,
  value: number,
  unitToken: string | undefined,
): HeuristicFallbackCandidate | null {
  const name = rawName.trim();
  if (!name || !Number.isFinite(value) || value <= 0) return null;
  // The "<number> <words>" shape is loose enough to also match prose (e.g.
  // "Rest 90 seconds"), so only emit a row when the words map to a known
  // exercise. This keeps the single-measurement branch high-precision.
  if (canonicalExerciseName(name) === "custom") return null;

  return { name, sets: 1, ...classifyMeasurement(value, unitToken) };
}

function parseSingleMeasurementChunk(chunk: string): HeuristicFallbackCandidate | null {
  const cleaned = chunk.replace(SINGLE_VALUE_LIST_MARKER_PATTERN, "").trim();
  if (!cleaned) return null;

  const measurementFirst = MEASUREMENT_FIRST_PATTERN.exec(cleaned);
  if (measurementFirst) {
    const candidate = buildSingleValueCandidate(
      measurementFirst[3],
      Number.parseFloat(measurementFirst[1]),
      measurementFirst[2],
    );
    if (candidate) return candidate;
  }

  const nameFirst = NAME_FIRST_TAIL_PATTERN.exec(cleaned);
  if (nameFirst) {
    const candidate = buildSingleValueCandidate(
      cleaned.slice(0, nameFirst.index),
      Number.parseFloat(nameFirst[1]),
      nameFirst[2],
    );
    if (candidate) return candidate;
  }

  return null;
}

// Handles "<exercise>: <measurement>" (e.g. "SkiErg: 1000m"), reusing the lead
// name already split from the chunk.
function parseLeadMeasurementChunk(lead: HeuristicLead | null): HeuristicFallbackCandidate | null {
  if (!lead) return null;

  const measurement = MEASUREMENT_ONLY_PATTERN.exec(lead.body.trim());
  if (!measurement) return null;

  return buildSingleValueCandidate(lead.name, Number.parseFloat(measurement[1]), measurement[2]);
}

function parseHeuristicFallbackChunk(chunk: string): HeuristicFallbackCandidate | null {
  const lead = parseHeuristicLead(chunk);
  const body = lead?.body ?? chunk;

  const namedCandidate = parseNamedHeuristicChunk(body);
  if (namedCandidate) return namedCandidate;

  const leadOnlyCandidate = parseLeadOnlyHeuristicChunk(lead, body);
  if (leadOnlyCandidate) return leadOnlyCandidate;

  const leadMeasurementCandidate = parseLeadMeasurementChunk(lead);
  if (leadMeasurementCandidate) return leadMeasurementCandidate;

  return parseSingleMeasurementChunk(body);
}

function buildSetValueFields(candidate: HeuristicFallbackCandidate): Record<string, number | string> {
  if (candidate.valueKind === "distance") {
    return candidate.distanceUnit
      ? { distance: candidate.value, distanceUnit: candidate.distanceUnit }
      : { distance: candidate.value };
  }

  if (candidate.valueKind === "weight") {
    return candidate.weightUnit
      ? { weight: candidate.value, weightUnit: candidate.weightUnit }
      : { weight: candidate.value };
  }

  return { [candidate.valueKind]: candidate.value };
}

function buildHeuristicFallbackRow(candidate: HeuristicFallbackCandidate): unknown {
  const exerciseName = canonicalExerciseName(candidate.name);
  return {
    exerciseName,
    category: categoryForExercise(exerciseName, candidate.name),
    ...(exerciseName === "custom" ? { customLabel: sanitizeLabel(candidate.name) } : {}),
    missingFields: ["Heuristic fallback parser used after malformed AI rows."],
    sets: Array.from({ length: candidate.sets }, (_value, index) => ({
      setNumber: index + 1,
      ...buildSetValueFields(candidate),
    })),
  };
}

export function heuristicFallbackRowsFromText(text: string): unknown[] {
  return text
    .split(HEURISTIC_CHUNK_SPLIT_PATTERN)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(parseHeuristicFallbackChunk)
    .filter((candidate): candidate is HeuristicFallbackCandidate => candidate != null)
    .map(buildHeuristicFallbackRow);
}
