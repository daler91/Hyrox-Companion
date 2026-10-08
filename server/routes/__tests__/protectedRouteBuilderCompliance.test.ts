import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE_DIRS = [
  path.resolve(process.cwd(), "server/routes"),
  path.resolve(process.cwd(), "server/routes/workouts"),
];

// Index of the quote that closes the string literal opening at `open`.
function closingQuote(src: string, open: number): number {
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === src[open]) return i;
  }
  throw new Error(`unterminated string at offset ${open}`);
}

// The top-level arguments of the call whose "(" is at `open`, as source text.
// Skips strings and comments, so a path in either quote style and an options
// object that contains braces are both read whole.
function readCallArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let argStart = open + 1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = closingQuote(src, i);
    } else if (src.startsWith("//", i)) {
      i = src.indexOf("\n", i);
      if (i === -1) break;
    } else if (src.startsWith("/*", i)) {
      i = src.indexOf("*/", i) + 1;
      if (i === 0) break;
    } else if ("([{".includes(ch)) {
      depth++;
    } else if (")]}".includes(ch)) {
      depth--;
      if (depth === 0) {
        args.push(src.slice(argStart, i).trim());
        return args.filter(Boolean);
      }
    } else if (ch === "," && depth === 1) {
      args.push(src.slice(argStart, i).trim());
      argStart = i + 1;
    }
  }
  throw new Error(`unterminated call at offset ${open}`);
}

interface ProtectedRegistration {
  file: string;
  path: string;
  options: string;
  /** Everything after the path: the options and the handler. */
  call: string;
}

function protectedRegistrations(file: string): ProtectedRegistration[] {
  const contents = readFileSync(file, "utf8");
  return [...contents.matchAll(/\bprotected(?:Post|Patch|Delete)\s*\(/g)].map((match) => {
    const [, routePath = "", options = "", ...handler] = readCallArgs(contents, match.index + match[0].length - 1);
    return { file: path.relative(process.cwd(), file), path: routePath, options, call: [options, ...handler].join(",\n") };
  });
}

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "_helpers" || entry.name === "tests") {
        return [];
      }
      return collectTsFiles(fullPath);
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [fullPath];
  });
}

describe("protected route builder compliance", () => {
  it("rejects direct protected middleware stacking on mutating routes", () => {
    const offenders: string[] = [];
    const directProtectedMutationPattern = /router\.(post|patch|delete)\([\s\S]*?(protectedMutationGuards|isAuthenticated)/;

    for (const dir of ROUTE_DIRS) {
      for (const file of collectTsFiles(dir)) {
        const contents = readFileSync(file, "utf8");
        if (directProtectedMutationPattern.test(contents)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  const routeFiles = collectTsFiles(path.resolve(process.cwd(), "server/routes")).filter((file) => !file.endsWith(".test.ts"));
  const registrations = routeFiles.flatMap(protectedRegistrations);
  const burnsBudget = (opts: string) => /aiBudget:\s*true/.test(opts) || /\baiBudgetCheck\b/.test(opts);
  const gatesConsent = (opts: string) => /aiConsent:\s*true/.test(opts) || /\baiConsentCheck\b/.test(opts);

  it("reads every protected registration's path and options (guards the scan below)", () => {
    expect(registrations.length).toBeGreaterThanOrEqual(100);
    const unread = registrations
      .filter(({ path: routePath, options }) => !routePath || !options.startsWith("{"))
      .map(({ file, path: routePath }) => `${file} :: ${routePath}`);
    expect(unread).toEqual([]);
  });

  // W24 — every endpoint that burns AI budget must also gate on AI consent, so
  // a compromised/out-of-date client can't forward user data to a provider that
  // the user never consented to. Routes wire this two ways: the builder option
  // flags (`aiConsent: true, aiBudget: true`) or the explicit middleware array
  // (`middleware: [aiConsentCheck, aiBudgetCheck, ...]`). This statically asserts
  // the invariant `budget ⇒ consent` for both styles, across all route files.
  describe("AI consent coverage", () => {
    const budgeted = registrations.filter(({ options }) => burnsBudget(options));

    it("finds the AI-budgeted endpoints (guards against the scan silently matching nothing)", () => {
      expect(budgeted.length).toBeGreaterThanOrEqual(10);
    });

    it("requires aiConsent on every AI-budgeted endpoint", () => {
      const violations = budgeted
        .filter(({ options }) => !gatesConsent(options))
        .map(({ file, options }) => `${file} :: ${options.slice(0, 100)}`);
      expect(violations).toEqual([]);
    });
  });

  // P6 (CODEBASE_ANALYSIS_2026-10-03) — the check above only sees routes that
  // already declare a budget, so a route that reached the AI parser and
  // declared neither flag passed it: the migration backfill sent up to 50
  // workout texts a call to the provider for athletes who never opted in. This
  // check starts from the parser instead. A protected route whose handler
  // calls a function that sends workout text or images to it must gate both
  // consent and budget.
  describe("AI parser coverage", () => {
    // The parser itself (server/gemini).
    const PARSER_FUNCTIONS = [
      "parseExercisesFromText",
      "parseExercisesFromImage",
      "parseWorkoutStructureFromText",
      "parseWorkoutStructureFromImage",
      "parseWorkoutStructureFromTextWithDiagnostics",
      "parseWorkoutStructureFromImageWithDiagnostics",
    ];

    // Every module outside server/gemini and server/routes that calls the
    // parser, or a function listed here, mapped to the functions it exports
    // for a route to reach the parser through. A module whose parse runs only
    // behind a consent and budget check of its own maps to where that check
    // is. A new caller fails the first test below until it is listed here.
    const PARSER_CALLERS: Record<string, readonly string[] | string> = {
      "server/services/assistedMigrationService.ts": ["runAssistedMigrationBackfill"],
      "server/services/workoutService/reparse.ts": [
        "reparseWorkout",
        "reparsePlanDay",
        "reparseWorkoutFromImage",
        "reparsePlanDayFromImage",
        "batchReparseWorkouts",
      ],
      "server/services/workoutService/setRows.ts": ["prepareParsedWorkout"],
      "server/services/parseWorkoutUseCases.ts": ["reparseWorkoutUseCase", "reparseWorkoutFromImageUseCase", "batchReparseWorkoutsUseCase"],
      "server/services/structuredPlanDaySuggestion.ts": ["parseStructuredPlanDaySuggestionRows"],
      "server/services/workoutUseCases.ts": "createWorkout checks consent and the budget before its legacy text parse (P15)",
      "server/services/aiSuggestionService.ts": "applyTimelineAiSuggestion checks the budget (getStructuredApplyBlocker) before it parses; its route gates consent",
      "server/services/planAdjustmentService.ts": "applyPlanAdjustmentProposal checks the budget (getStructuredApplyBlocker) before it parses; its callers gate consent",
      "server/services/coachService.ts": "triggerAutoCoach checks aiCoachEnabled, and parses only when the budget allows the model pass",
    };

    const parserReaching = [...PARSER_FUNCTIONS, ...Object.values(PARSER_CALLERS).filter((v) => Array.isArray(v)).flat()];
    const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // String scans rather than a RegExp built from each name.
    // charAt is "" past either end, which is not an identifier character.
    const isIdentChar = (c: string) => /[\w$]/.test(c);
    /** Whether `src` calls `name(`, as opposed to declaring `function name(`. */
    const callsName = (src: string, name: string) => {
      for (let i = src.indexOf(name); i !== -1; i = src.indexOf(name, i + 1)) {
        if (isIdentChar(src.charAt(i - 1))) continue;
        let j = i + name.length;
        while (j < src.length && /\s/.test(src.charAt(j))) j++;
        if (src.charAt(j) !== "(") continue;
        if (/function\s+$/.test(src.slice(Math.max(0, i - 40), i))) continue;
        return true;
      }
      return false;
    };
    const callsOneOf = (src: string, names: readonly string[]) => names.some((name) => callsName(src, name));
    const exportsName = (contents: string, name: string) =>
      [`export function ${name}`, `export async function ${name}`, `export const ${name}`].some((decl) => {
        for (let i = contents.indexOf(decl); i !== -1; i = contents.indexOf(decl, i + 1)) {
          if (!isIdentChar(contents.charAt(i + decl.length))) return true;
        }
        return false;
      });

    const aiParseRoutes = registrations.filter(({ call }) => callsOneOf(withoutComments(call), parserReaching));

    it("lists every module that calls the AI parser or one of its wrappers", () => {
      const serverDir = path.resolve(process.cwd(), "server");
      const unlisted = collectTsFiles(serverDir)
        .map((file) => path.relative(process.cwd(), file))
        .filter((file) => !/\.test\.ts$|testSetup\.ts$|testHelpers\.ts$/.test(file))
        .filter((file) => !file.startsWith("server/gemini/") && !file.startsWith("server/routes/"))
        .filter((file) => !(file in PARSER_CALLERS))
        .filter((file) => callsOneOf(withoutComments(readFileSync(file, "utf8")), parserReaching));
      expect(unlisted).toEqual([]);
    });

    it("lists only functions its modules still export", () => {
      const missing = Object.entries(PARSER_CALLERS).flatMap(([file, entry]) => {
        if (typeof entry === "string") return [];
        const contents = readFileSync(file, "utf8");
        return entry
          .filter((name) => !exportsName(contents, name))
          .map((name) => `${file} :: ${name}`);
      });
      expect(missing).toEqual([]);
    });

    it("finds the routes that reach the AI parser (guards against the scan silently matching nothing)", () => {
      expect(aiParseRoutes.length).toBeGreaterThanOrEqual(10);
    });

    it("requires aiConsent and aiBudget on every route that reaches the AI parser", () => {
      const violations = aiParseRoutes
        .filter(({ options }) => !gatesConsent(options) || !burnsBudget(options))
        .map(({ file, path: routePath }) => `${file} :: ${routePath}`);
      expect(violations).toEqual([]);
    });
  });
});
