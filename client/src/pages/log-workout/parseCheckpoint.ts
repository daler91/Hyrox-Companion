interface ContinueParseParams {
  readonly freeText: string;
  readonly lastParsedText: string;
  readonly hasBlocks: boolean;
}

/**
 * Returns whether Continue should trigger a fresh parse before moving from
 * Capture -> Confirm. This logic intentionally lives outside CaptureStep so
 * the parsed-text checkpoint survives step unmount/remount cycles.
 */
export function shouldTriggerParseOnContinue({
  freeText,
  lastParsedText,
  hasBlocks,
}: ContinueParseParams): boolean {
  const hasText = freeText.trim().length > 0;
  return hasText && (freeText !== lastParsedText || !hasBlocks);
}
