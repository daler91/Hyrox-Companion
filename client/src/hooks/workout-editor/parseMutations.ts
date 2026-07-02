import type { StructureBlockInput } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import type { MutableRefObject } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { useToast } from "@/hooks/use-toast";
import { api, type ParseFromImagePayload, type ParseWorkoutStructureResponse } from "@/lib/api";

import { getParseSuccessDescription, processParsedExercises } from "./parseMerging";
import { rowsForParsedStructure } from "./structureRows";

export async function parseWorkoutText(text: string): Promise<ParseWorkoutStructureResponse> {
  return api.exercises.parseStructured(text);
}

export interface UseParseWorkoutMutationOptions {
  onSuccess: (newBlocks: string[], newData: Record<string, StructuredExercise>, structureBlocks: StructureBlockInput[]) => void;
  onError: () => void;
}

interface ParseCopy {
  readonly emptyDescription: string;
  readonly errorDescription: string;
}

// Text- and image-parse diverge only in (a) how Gemini is called and (b)
// the toast copy for the "no exercises detected" / "parse failed" paths.
// Share the post-parse pipeline through a single factory so a future tweak
// to the merge/replace logic can't drift between the two surfaces.
function useParseMutationBase<TVariables>(
  blockCounterRef: MutableRefObject<number>,
  options: UseParseWorkoutMutationOptions,
  mutationFn: (variables: TVariables) => Promise<ParseWorkoutStructureResponse>,
  copy: ParseCopy,
) {
  const { toast } = useToast();

  return useMutation<ParseWorkoutStructureResponse, Error, TVariables>({
    mutationFn,
    onSuccess: (parsed) => {
      const normalized = rowsForParsedStructure(parsed);
      if (normalized.exercises.length === 0 && normalized.structureBlocks.length === 0) {
        toast({
          title: "No exercises found",
          description: copy.emptyDescription,
          variant: "destructive",
        });
        return;
      }

      const { newBlocks, newData } = processParsedExercises(normalized.exercises, blockCounterRef);
      options.onSuccess(newBlocks, newData, normalized.structureBlocks);

      toast({
        title: "Exercises parsed",
        description: getParseSuccessDescription(normalized.exercises),
      });
    },
    onError: () => {
      toast({
        title: "Parsing failed",
        description: copy.errorDescription,
        variant: "destructive",
      });
      options.onError();
    },
  });
}

export function useParseWorkoutMutation(
  blockCounterRef: MutableRefObject<number>,
  options: UseParseWorkoutMutationOptions,
) {
  return useParseMutationBase<string>(blockCounterRef, options, parseWorkoutText, {
    emptyDescription:
      "AI couldn't identify any exercises in your text. Try being more specific, e.g. '4x8 back squat at 70kg'.",
    errorDescription:
      "AI couldn't parse your workout text. Please try again or enter exercises manually.",
  });
}

export type ParseImagePayload = ParseFromImagePayload;

/**
 * Parse a captured photo of a workout plan into structured blocks. Shares
 * the same post-parse pipeline (`processParsedExercises` → replace blocks)
 * and success/error toast copy family as the text-parse mutation so a
 * source switch doesn't introduce behavioural drift.
 */
export function useParseWorkoutFromImageMutation(
  blockCounterRef: MutableRefObject<number>,
  options: UseParseWorkoutMutationOptions,
) {
  return useParseMutationBase<ParseImagePayload>(
    blockCounterRef,
    options,
    (payload) => api.exercises.parseStructuredFromImage(payload),
    {
      emptyDescription:
        "AI couldn't identify any exercises in that photo. Try a clearer shot with the workout in frame.",
      errorDescription:
        "AI couldn't parse that photo. Try a clearer shot or enter exercises manually.",
    },
  );
}
