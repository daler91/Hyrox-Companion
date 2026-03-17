import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceInput } from "../useVoiceInput";

const mockRecognitionInstances: any[] = [];

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
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
  const results: any = texts.map((t) => {
    const r: any = [{ transcript: t.transcript }];
    r.isFinal = t.isFinal;
    return r;
  });
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

function triggerResult(recognition: any, transcript: string, isFinal = true) {
  act(() => {
    recognition.onresult(makeResultEvent([{ transcript, isFinal }]));
  });
}

describe("useVoiceInput dedup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRecognitionInstances.length = 0;
    (window as any).SpeechRecognition = MockSpeechRecognition;

    Object.defineProperty(navigator, "mediaDevices", {
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
    delete (window as any).SpeechRecognition;
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

  it("allows same text after dedup window expires", async () => {
    const { onResult, recognition } = await setupVoiceInput();

    triggerResult(recognition, "house", true);
    expect(onResult).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3100);

    triggerResult(recognition, "house", true);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("resets dedup state on new startListening call", async () => {
    const { onResult, hook } = await setupVoiceInput();
    let currentRec = mockRecognitionInstances.at(-1);

    triggerResult(currentRec, "house", true);
    expect(onResult).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.stopListening());
    await act(async () => {
      hook.result.current.startListening();
      await vi.advanceTimersByTimeAsync(10);
    });

    currentRec = mockRecognitionInstances.at(-1);
    triggerResult(currentRec, "house", true);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("allows different texts within the same window", async () => {
    const { onResult, recognition } = await setupVoiceInput();

    triggerResult(recognition, "house", true);

    act(() => {
      recognition.onresult(
        makeResultEvent(
          [
            { transcript: "house", isFinal: true },
            { transcript: "car", isFinal: true },
          ],
          1,
        ),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith("house");
    expect(onResult).toHaveBeenCalledWith("car");
  });
});
