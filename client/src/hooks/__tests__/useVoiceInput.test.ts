import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput } from "../useVoiceInput";

const mockRecognitionInstances: MockSpeechRecognition[] = [];

interface SpeechResultEvent {
  results: SpeechResultList;
  resultIndex: number;
}

interface SpeechResultList {
  [index: number]: SpeechResult;
  length: number;
}

interface SpeechResult {
  [index: number]: { transcript: string };
  isFinal: boolean;
}

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: SpeechResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();

  start() {
    mockRecognitionInstances.push(this);
    Promise.resolve().then(() => this.onstart?.());
  }
  stop() {
    this.onend?.();
  }
  abort() {
    // Intentionally blank - mock implementation for testing
  }
}

function makeResultEvent(
  texts: Array<{ transcript: string; isFinal: boolean }>,
  resultIndex = 0,
) {
  const results = texts.map((t) => {
    const r = Object.assign([{ transcript: t.transcript }], { isFinal: t.isFinal }) as SpeechResult;
    return r;
  }) as unknown as SpeechResultList;
  results.length = texts.length;
  return { results, resultIndex };
}

async function startHook(onResult: ReturnType<typeof vi.fn>) {
  const hook = renderHook(() => useVoiceInput({ onResult }));

  await act(async () => {
    hook.result.current.startListening();
    await vi.advanceTimersByTimeAsync(10);
  });

  const recognition = mockRecognitionInstances.at(-1);
  return { hook, recognition };
}

async function setupVoiceInput() {
  const onResult = vi.fn();
  const { hook, recognition } = await startHook(onResult);
  return { onResult, hook, recognition };
}

function triggerResult(recognition: MockSpeechRecognition, transcript: string, isFinal = true) {
  act(() => {
    recognition.onresult(makeResultEvent([{ transcript, isFinal }]));
  });
}

describe("useVoiceInput dedup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRecognitionInstances.length = 0;
    (globalThis.window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    delete (globalThis.window as unknown as Record<string, unknown>).SpeechRecognition;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "emits a final transcript once",
      actions: [{ text: "house" }],
      expectedTimes: 1,
      expectedArgs: ["house"],
    },
    {
      name: "skips duplicate final transcript within dedup window",
      actions: [{ text: "house" }, { text: "house" }, { text: "house" }],
      expectedTimes: 1,
      expectedArgs: ["house"],
    },
    {
      name: "dedup is case-insensitive",
      actions: [{ text: "House" }, { text: "house" }],
      expectedTimes: 1,
      expectedArgs: ["House"],
    },
  ])("$name", async ({ actions, expectedTimes, expectedArgs }) => {
    const { onResult, recognition } = await setupVoiceInput();

    for (const action of actions) {
      triggerResult(recognition, action.text, true);
    }

    expect(onResult).toHaveBeenCalledTimes(expectedTimes);
    if (expectedArgs) {
      expect(onResult).toHaveBeenCalledWith(...expectedArgs);
    }
  });

  it("handles complex dedup lifecycles (timers, restarts, multiple results)", async () => {
    const { onResult, hook } = await setupVoiceInput();
    let rec = mockRecognitionInstances.at(-1);

    // 1. Allows same text after dedup window expires
    triggerResult(rec, "house", true);
    expect(onResult).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3100);
    triggerResult(rec, "house", true);
    expect(onResult).toHaveBeenCalledTimes(2);

    // 2. Allows different texts within the same window
    act(() => {
      rec.onresult(
        makeResultEvent(
          [
            { transcript: "house", isFinal: true },
            { transcript: "car", isFinal: true },
          ],
          1,
        ),
      );
    });
    expect(onResult).toHaveBeenCalledTimes(3);
    // Previous "house" calls: 2. This call pushes "house" (ignored, deduped) + "car" (new). Total = 3.
    // Wait, since we are calling it sequentially:
    // Let's verify expectations: 2 times from step 1.
    // The makeResultEvent pushes two transcripts at once. "house" is deduped because we just triggered "house".
    // "car" is new, so it triggers. Total times = 3.

    // 3. Resets dedup state on new startListening call
    act(() => hook.result.current.stopListening());
    await act(async () => {
      hook.result.current.startListening();
      await vi.advanceTimersByTimeAsync(10);
    });
    rec = mockRecognitionInstances.at(-1);
    triggerResult(rec, "car", true);
    // Since we restarted, "car" is no longer deduped.
    // Total = 4.
    expect(onResult).toHaveBeenCalledTimes(4); // 3 (previous) + 1 (car after restart) = 4
  });
});
