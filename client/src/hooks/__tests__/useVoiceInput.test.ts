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

  const recognition =
    mockRecognitionInstances[mockRecognitionInstances.length - 1];
  return { hook, recognition };
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

  it("emits a final transcript once", async () => {
    const onResult = vi.fn();
    const { recognition } = await startHook(onResult);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("house");
  });

  it("skips duplicate final transcript within dedup window", async () => {
    const onResult = vi.fn();
    const { recognition } = await startHook(onResult);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("allows same text after dedup window expires", async () => {
    const onResult = vi.fn();
    const { recognition } = await startHook(onResult);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3100);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("dedup is case-insensitive", async () => {
    const onResult = vi.fn();
    const { recognition } = await startHook(onResult);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "House", isFinal: true }]),
      );
    });

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("resets dedup state on new startListening call", async () => {
    const onResult = vi.fn();
    const { hook } = await startHook(onResult);

    let recognition =
      mockRecognitionInstances[mockRecognitionInstances.length - 1];

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(1);

    act(() => {
      hook.result.current.stopListening();
    });

    await act(async () => {
      hook.result.current.startListening();
      await vi.advanceTimersByTimeAsync(10);
    });

    recognition = mockRecognitionInstances[mockRecognitionInstances.length - 1];

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("allows different texts within the same window", async () => {
    const onResult = vi.fn();
    const { recognition } = await startHook(onResult);

    act(() => {
      recognition.onresult(
        makeResultEvent([{ transcript: "house", isFinal: true }]),
      );
    });

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
