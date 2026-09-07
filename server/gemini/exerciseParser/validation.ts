import { logger } from "../../logger";
import { formatZodIssues, sanitizeForLog } from "../../utils/sanitize";
import { parsedExerciseSchema, type ParserExercise } from "./schema";

export interface ValidatedRows {
  acceptedRows: ParserExercise[];
  rejectedRows: { index: number; reason: string }[];
}

interface MalformedRowSummary {
  keyCount: number;
  keys: string[];
  exerciseNameType: string;
  exerciseNamePreview: string | null;
  categoryType: string;
  categoryPreview: string | null;
  setsType: string;
  setsLength: number | null;
  rawPreview: string;
}

function summarizeMalformedRow(row: unknown): MalformedRowSummary {
  const asRecord = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
  const keys = Object.keys(asRecord ?? {}).slice(0, 12).map(sanitizeForLog);
  const exerciseName = asRecord && typeof asRecord.exerciseName === "string" ? asRecord.exerciseName : null;
  const category = asRecord && typeof asRecord.category === "string" ? asRecord.category : null;
  const setsValue = asRecord ? asRecord.sets : undefined;
  const setsType = Array.isArray(setsValue) ? "array" : typeof setsValue;
  const setsLength = Array.isArray(setsValue) ? setsValue.length : null;
  const rawPreview = (() => {
    try {
      const serialized = JSON.stringify(row);
      return serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
    } catch {
      return String(row);
    }
  })();

  return {
    keyCount: keys.length,
    keys,
    exerciseNameType: typeof (asRecord ? asRecord.exerciseName : undefined),
    exerciseNamePreview: exerciseName ? sanitizeForLog(exerciseName.slice(0, 80)) : null,
    categoryType: typeof (asRecord ? asRecord.category : undefined),
    categoryPreview: category ? sanitizeForLog(category.slice(0, 80)) : null,
    setsType,
    setsLength,
    rawPreview: sanitizeForLog(rawPreview),
  };
}

export function validateRowsDetailed(rawArray: unknown[]): ValidatedRows {
  const acceptedRows: ParserExercise[] = [];
  const rejectedRows: { index: number; reason: string }[] = [];

  for (let index = 0; index < rawArray.length; index++) {
    const row = rawArray[index];
    const parsed = parsedExerciseSchema.safeParse(row);

    if (parsed.success) {
      acceptedRows.push(parsed.data);
      continue;
    }

    const issuesSummary = formatZodIssues(parsed.error.issues);
    const rowSummary = summarizeMalformedRow(row);
    // The row's content stays in the sanitized structured fields; the message
    // string carries only our own values so a crafted row can't reshape it.
    logger.warn(
      { index, issuesSummary, rowSummary },
      `[ai] exercise-parse dropped malformed row (idx=${index})`,
    );
    rejectedRows.push({ index, reason: `schema_validation_failed: ${issuesSummary}` });
  }

  return { acceptedRows, rejectedRows };
}

export function validateRows(rawArray: unknown[]): ParserExercise[] {
  return validateRowsDetailed(rawArray).acceptedRows;
}
