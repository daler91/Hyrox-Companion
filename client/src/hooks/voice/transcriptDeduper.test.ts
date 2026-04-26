import { describe, expect, it } from "vitest";

import { dedupeFinalTranscript, type TranscriptEmission } from "./transcriptDeduper";

const WINDOW_MS = 3_000;

describe("dedupeFinalTranscript", () => {
  it("emits new transcripts and stores the normalized text", () => {
    const result = dedupeFinalTranscript("House", [], 1_000, WINDOW_MS);

    expect(result.textToEmit).toBe("House");
    expect(result.emissions).toEqual([{ text: "house", time: 1_000 }]);
  });

  it("suppresses duplicates and subset repeats inside the dedup window", () => {
    const recent: TranscriptEmission[] = [{ text: "house party", time: 1_000 }];

    expect(dedupeFinalTranscript("house party", recent, 1_500, WINDOW_MS).textToEmit).toBeNull();
    expect(dedupeFinalTranscript("house", recent, 1_500, WINDOW_MS).textToEmit).toBeNull();
  });

  it("emits only the new suffix when a transcript extends an earlier result", () => {
    const result = dedupeFinalTranscript(
      "house party",
      [{ text: "house", time: 1_000 }],
      1_500,
      WINDOW_MS,
    );

    expect(result.textToEmit).toBe("party");
    expect(result.emissions).toEqual([{ text: "house party", time: 1_500 }]);
  });

  it("allows the same transcript again after the dedup window expires", () => {
    const result = dedupeFinalTranscript(
      "house",
      [{ text: "house", time: 1_000 }],
      5_000,
      WINDOW_MS,
    );

    expect(result.textToEmit).toBe("house");
  });
});
