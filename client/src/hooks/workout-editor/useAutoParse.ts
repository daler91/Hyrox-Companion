import type { StructureBlockInput } from "@shared/schema";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { api, type ParseWorkoutStructureResponse } from "@/lib/api";

import { mergeParsedWithEdits } from "./parseMerging";
import { rowsForParsedStructure } from "./structureRows";

export interface ParseDiagnostics {
  readonly lowConfidenceCount: number;
  readonly emptyResult: boolean;
  readonly lastErrorReason: string | null;
  readonly lastConfidenceSummary: string | null;
}

const AUTO_PARSE_DEBOUNCE_MS = 1200;
const AUTO_PARSE_MIN_CHARS = 8;
// Cheap gate so the auto-parse pipeline doesn't burn AI provider calls on
// free-form notes like "felt great". Needs at least one digit or an
// `x`/`×` (set-count separator) before we even consider parsing.
const AUTO_PARSE_SIGNAL_RE = /\d|[xX×]/;

const EMPTY_DIAGNOSTICS: ParseDiagnostics = {
  lowConfidenceCount: 0,
  emptyResult: false,
  lastErrorReason: null,
  lastConfidenceSummary: null,
};

function shouldRunAutoParse(trimmed: string, lastParsedText: string): boolean {
  return (
    trimmed.length > 0 &&
    trimmed !== lastParsedText &&
    trimmed.length >= AUTO_PARSE_MIN_CHARS &&
    AUTO_PARSE_SIGNAL_RE.test(trimmed)
  );
}

function buildAutoParseDiagnostics(parsed: ParseWorkoutStructureResponse): ParseDiagnostics {
  const lowConfidenceCount = parsed.exercises.filter((row) => typeof row.confidence === "number" && row.confidence < 80).length;
  const emptyResult = parsed.exercises.length === 0 && parsed.structureBlocks.length === 0;
  return {
    lowConfidenceCount,
    emptyResult,
    lastErrorReason: null,
    lastConfidenceSummary: emptyResult
      ? "No exercises were detected in the parse response."
      : `Parsed ${parsed.exercises.length} exercises and ${parsed.structureBlocks.length} blocks; ${lowConfidenceCount} below confidence 80.`,
  };
}

function shouldIgnoreAutoParseError(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof DOMException && err.name === "AbortError");
}

function parseErrorReason(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown parse error";
}

interface UseAutoParseOptions {
  blockCounterRef: MutableRefObject<number>;
  // Live refs owned by useWorkoutEditor so the debounced callback sees the
  // latest merge inputs when it fires (see the comment there).
  blocksRef: MutableRefObject<string[]>;
  dataRef: MutableRefObject<Record<string, StructuredExercise>>;
  onApply: (
    newBlocks: string[],
    newData: Record<string, StructuredExercise>,
    structureBlocks: StructureBlockInput[],
  ) => void;
}

/**
 * The live-typing auto-parse engine: trailing-debounced Gemini calls with
 * a single AbortController following the most recent request, merge of
 * parse results with user-edited blocks, and diagnostics for the composer
 * UI. Extracted from useWorkoutEditor, which composes it with block state.
 */
export function useAutoParse({ blockCounterRef, blocksRef, dataRef, onApply }: UseAutoParseOptions) {
  // A single AbortController follows the most recent auto-parse request.
  // Typing during an in-flight request aborts it and the trailing debounce
  // fires a fresh call once the user pauses for `AUTO_PARSE_DEBOUNCE_MS`.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedTextRef = useRef<string>("");
  const [autoParsing, setAutoParsing] = useState(false);
  const [autoParseError, setAutoParseError] = useState(false);
  const [lastParsedAt, setLastParsedAt] = useState<number | null>(null);
  const [parseDiagnostics, setParseDiagnostics] = useState<ParseDiagnostics>(EMPTY_DIAGNOSTICS);

  const applyAutoParseResult = useCallback((parsed: ParseWorkoutStructureResponse) => {
    const normalized = rowsForParsedStructure(parsed);
    const { newBlocks, newData } = mergeParsedWithEdits(
      normalized.exercises,
      blockCounterRef,
      blocksRef.current,
      dataRef.current,
    );
    onApply(newBlocks, newData, normalized.structureBlocks);
  }, [blockCounterRef, blocksRef, dataRef, onApply]);

  const runAutoParse = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!shouldRunAutoParse(trimmed, lastParsedTextRef.current)) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAutoParsing(true);
    setAutoParseError(false);

    try {
      const parsed = await api.exercises.parseStructured(trimmed, { signal: controller.signal });
      if (controller.signal.aborted) return;
      lastParsedTextRef.current = trimmed;
      setParseDiagnostics(buildAutoParseDiagnostics(parsed));
      applyAutoParseResult(parsed);
      setLastParsedAt(Date.now());
    } catch (err) {
      if (shouldIgnoreAutoParseError(err, controller.signal)) return;
      setAutoParseError(true);
      setParseDiagnostics((prev) => ({
        ...prev,
        lastErrorReason: parseErrorReason(err),
      }));
    } finally {
      // Always clear the spinner. Earlier this was gated on
      // `!controller.signal.aborted`, but that left the state stuck
      // true when a parse was aborted AND the subsequent debounced
      // call short-circuited (empty text, under-length, etc.) —
      // nothing in that fast-path resets the flag. A fresh parse will
      // immediately setAutoParsing(true) again; React batches these
      // so there's no visible flicker.
      setAutoParsing(false);
    }
  }, [applyAutoParseResult]);

  // Schedule a trailing-debounced auto-parse whenever the free-text
  // changes. Any pending parse gets cancelled on the next call so only
  // the latest text flows through — AND any IN-FLIGHT request is
  // aborted synchronously here so a slow response from outdated text
  // can't land after the user has already moved on and overwrite the
  // composer's state with stale blocks.
  const scheduleAutoParse = useCallback(
    (text: string) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runAutoParse(text).catch(() => {
          /* errors surface via autoParseError state inside runAutoParse */
        });
      }, AUTO_PARSE_DEBOUNCE_MS);
    },
    [runAutoParse],
  );

  // Stops any in-flight auto-parse plus the scheduled trailing call.
  // The composer invokes this when the user touches an exercise row so
  // a fresh parse doesn't yank their edit out from under them. Next
  // free-text change re-primes the debounce.
  const cancelAutoParse = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    if (autoParsing) setAutoParsing(false);
  }, [autoParsing]);

  // Fire a parse immediately, bypassing the debounce. Used by the
  // composer's manual Parse button — the user explicitly asked to
  // parse, so don't wait for the trailing debounce. Also resets the
  // "last parsed text" snapshot so clicking Parse on unchanged text
  // re-runs the parse (common after toggling blocks).
  const parseNow = useCallback(
    (text: string) => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortRef.current?.abort();
      lastParsedTextRef.current = "";
      runAutoParse(text).catch(() => {
        /* errors surface via autoParseError state inside runAutoParse */
      });
    },
    [runAutoParse],
  );

  // Clear any in-flight auto-parse state so freshly reset content isn't
  // overwritten by a debounced call from the previous session. Called by
  // useWorkoutEditor's resetEditor.
  const resetAutoParse = useCallback(() => {
    lastParsedTextRef.current = "";
    abortRef.current?.abort();
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setAutoParsing(false);
    setAutoParseError(false);
    setParseDiagnostics(EMPTY_DIAGNOSTICS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    autoParsing,
    autoParseError,
    parseDiagnostics,
    lastParsedAt,
    scheduleAutoParse,
    cancelAutoParse,
    parseNow,
    resetAutoParse,
  };
}
