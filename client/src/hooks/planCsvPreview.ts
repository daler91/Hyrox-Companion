/** Data rows the import preview shows before "… and N more workouts". */
export const PLAN_CSV_PREVIEW_ROWS = 10;

export interface PlanCsvPreviewRow {
  /** The row's place among the file's data rows, from 1: a stable, unique key. */
  rowNumber: number;
  weekNumber: number;
  dayName: string;
  focus: string;
  mainWorkout: string;
}

export interface PlanCsvPreview {
  rows: PlanCsvPreviewRow[];
  /** Data rows after the previewed ones. */
  remainingRows: number;
}

interface CsvScan {
  records: string[][];
  fields: string[];
  field: string;
  quoted: boolean;
  /** The last character closed a quoted field, so a quote now is an escaped `""`. */
  afterClosingQuote: boolean;
}

function endField(scan: CsvScan): void {
  scan.fields.push(scan.field.trim());
  scan.field = "";
}

function endRecord(scan: CsvScan): void {
  endField(scan);
  scan.records.push(scan.fields);
  scan.fields = [];
}

// A quote opening a field (spaces before it aside) starts a quoted field. Any
// other is kept as written, as the server's parser does (relax_quotes).
function readQuote(scan: CsvScan): void {
  if (scan.field.trim() === "") {
    scan.field = "";
    scan.quoted = true;
  } else {
    scan.field += '"';
  }
}

function readUnquoted(scan: CsvScan, char: string): void {
  if (char === '"') readQuote(scan);
  else if (char === ",") endField(scan);
  else if (char === "\n") endRecord(scan);
  else if (char !== "\r") scan.field += char;
}

// Right after a quoted field closes, a second quote makes `""`: one literal
// quote, and the field is quoted again.
function readAfterClosingQuote(scan: CsvScan, char: string): void {
  scan.afterClosingQuote = false;
  if (char === '"') {
    scan.field += '"';
    scan.quoted = true;
    return;
  }
  readUnquoted(scan, char);
}

function readQuoted(scan: CsvScan, char: string): void {
  if (char === '"') {
    scan.quoted = false;
    scan.afterClosingQuote = true;
  } else {
    scan.field += char;
  }
}

function isBlankRecord(record: readonly string[]): boolean {
  return record.every((field) => field === "");
}

/**
 * CSV text as records of trimmed fields. A comma or line break inside a quoted
 * field stays in it, `""` is a literal quote, CRLF reads as LF, and blank lines
 * (a trailing newline among them) are dropped, as the server's import does
 * (csv-parse with skip_empty_lines and trim).
 */
export function parseCsvRecords(text: string): string[][] {
  const scan: CsvScan = {
    records: [],
    fields: [],
    field: "",
    quoted: false,
    afterClosingQuote: false,
  };
  for (const char of text) {
    if (scan.quoted) readQuoted(scan, char);
    else if (scan.afterClosingQuote) readAfterClosingQuote(scan, char);
    else readUnquoted(scan, char);
  }
  endRecord(scan);
  return scan.records.filter((record) => !isBlankRecord(record));
}

function column(record: readonly string[], index: number): string {
  return index < 0 ? "" : (record.at(index) ?? "");
}

/**
 * The first rows of a plan CSV for the import preview, and how many follow.
 * Reads the file as CSV: the preview split rows on raw commas, so a quoted
 * workout with a comma in it shifted every column after it, and it counted a
 * trailing newline as one more workout. The server's import never used this.
 * CL49 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function parsePlanCsvPreview(csvContent: string): PlanCsvPreview {
  const [header, ...dataRows] = parseCsvRecords(csvContent);
  // No data rows also covers an empty file, where there is no header either.
  if (dataRows.length === 0) return { rows: [], remainingRows: 0 };

  const headers = header.map((name) => name.toLowerCase());
  const weekIdx = headers.findIndex((name) => name.includes("week"));
  const dayIdx = headers.findIndex((name) => name.includes("day"));
  const focusIdx = headers.findIndex((name) => name.includes("focus") || name.includes("type"));
  const workoutIdx = headers.findIndex((name) => name.includes("workout") || name.includes("main"));

  const previewed = dataRows.slice(0, PLAN_CSV_PREVIEW_ROWS);
  const rows = previewed.flatMap((record, offset) =>
    record.length >= 4
      ? [
          {
            rowNumber: offset + 1,
            weekNumber: Number.parseInt(column(record, weekIdx) || "1", 10) || 1,
            dayName: column(record, dayIdx),
            focus: column(record, focusIdx),
            mainWorkout: column(record, workoutIdx),
          },
        ]
      : [],
  );
  return { rows, remainingRows: dataRows.length - previewed.length };
}
