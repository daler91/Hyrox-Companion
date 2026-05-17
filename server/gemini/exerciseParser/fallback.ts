import { VALID_EXERCISE_NAMES } from "../../prompts";
import { sanitizeLabel } from "./mapping";

const HEURISTIC_CHUNK_SPLIT_PATTERN = /[.;\n]+/;
const HEURISTIC_TIME_UNITS = ["minutes", "minute", "mins", "min"] as const;
const CONDITIONING_NAME_PATTERN = /(row|run|bike|ski|erg|amrap|emom|interval)/i;

interface HeuristicFallbackCandidate {
  name: string;
  sets: number;
  value: number;
  valueKind: "reps" | "time";
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

function canonicalExerciseName(label: string): string {
  const normalized = sanitizeLabel(label).toLowerCase().replaceAll(/\s+/g, "_");
  const aliases: Record<string, string> = {
    "back_squat": "back_squat",
    "squat": "back_squat",
    "deadlift": "deadlift",
    "row": "rowing",
    "rowing": "rowing",
  };
  const alias = aliases[normalized];

  if (alias) return alias;

  return VALID_EXERCISE_NAMES instanceof Set && VALID_EXERCISE_NAMES.has(normalized) ? normalized : "custom";
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

function parseHeuristicFallbackChunk(chunk: string): HeuristicFallbackCandidate | null {
  const lead = parseHeuristicLead(chunk);
  const body = lead?.body ?? chunk;
  const namedCandidate = parseNamedHeuristicChunk(body);

  if (namedCandidate) {
    return namedCandidate;
  }

  return parseLeadOnlyHeuristicChunk(lead, body);
}

function buildHeuristicFallbackRow(candidate: HeuristicFallbackCandidate): unknown {
  const exerciseName = canonicalExerciseName(candidate.name);
  return {
    exerciseName,
    category: CONDITIONING_NAME_PATTERN.test(candidate.name) ? "conditioning" : "strength",
    ...(exerciseName === "custom" ? { customLabel: sanitizeLabel(candidate.name) } : {}),
    missingFields: ["Heuristic fallback parser used after malformed AI rows."],
    sets: Array.from({ length: candidate.sets }, (_value, index) => ({
      setNumber: index + 1,
      [candidate.valueKind]: candidate.value,
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
