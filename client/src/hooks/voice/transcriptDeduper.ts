export interface TranscriptEmission {
  readonly text: string;
  readonly time: number;
}

export interface TranscriptDedupResult {
  readonly emissions: TranscriptEmission[];
  readonly textToEmit: string | null;
}

export function dedupeFinalTranscript(
  finalTranscript: string,
  recentEmissions: readonly TranscriptEmission[],
  now: number,
  dedupWindowMs: number,
): TranscriptDedupResult {
  const normalized = finalTranscript.trim().toLowerCase();
  const activeEmissions = recentEmissions.filter((emission) => now - emission.time < dedupWindowMs);

  const exactOrSubset = activeEmissions.some(
    (emission) => emission.text === normalized || emission.text.startsWith(normalized),
  );
  if (exactOrSubset) {
    return { emissions: activeEmissions, textToEmit: null };
  }

  const supersetIndex = activeEmissions.findIndex((emission) =>
    normalized.startsWith(emission.text),
  );
  if (supersetIndex === -1) {
    return {
      emissions: [...activeEmissions, { text: normalized, time: now }],
      textToEmit: finalTranscript,
    };
  }

  const previousText = activeEmissions[supersetIndex].text;
  const delta = normalized.slice(previousText.length).trim();
  const nextEmissions = [...activeEmissions];
  nextEmissions[supersetIndex] = { text: normalized, time: now };

  return {
    emissions: nextEmissions,
    textToEmit: delta || null,
  };
}
