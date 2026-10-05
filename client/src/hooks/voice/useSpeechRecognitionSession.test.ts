import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeechRecognitionEvent } from "./types";
import { useSpeechRecognitionSession } from "./useSpeechRecognitionSession";

interface Heard {
  readonly transcript: string;
  readonly isFinal: boolean;
}

/** A recogniser driven by the test; stop() only asks it to finish, as in a browser. */
class FakeRecognition {
  static readonly instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  readonly abort = vi.fn();
  readonly stop = vi.fn();

  start() {
    FakeRecognition.instances.push(this);
    this.onstart?.();
  }

  /** One result event carrying these results; a no-op once the session detached it. */
  hear(...heard: Heard[]) {
    const results = heard.map((h) =>
      Object.assign([{ transcript: h.transcript }], { isFinal: h.isFinal }),
    );
    act(() => {
      this.onresult?.({ resultIndex: 0, results } as unknown as SpeechRecognitionEvent);
    });
  }

  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
    });
  }

  end() {
    act(() => {
      this.onend?.();
    });
  }
}

const final = (transcript: string): Heard => ({ transcript, isFinal: true });
const interim = (transcript: string): Heard => ({ transcript, isFinal: false });

const onResult = vi.fn<(transcript: string) => void>();

async function startSession() {
  const hook = renderHook(() => useSpeechRecognitionSession({ onResult }));
  await act(async () => {
    await hook.result.current.startListening();
  });
  const recognition = FakeRecognition.instances.at(-1);
  if (!recognition) throw new Error("recognition did not start");
  return { hook, recognition };
}

describe("useSpeechRecognitionSession stop (CL30)", () => {
  beforeEach(() => {
    onResult.mockReset();
    FakeRecognition.instances.length = 0;
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.navigator, "mediaDevices");
  });

  it("keeps showing the phrase being spoken when one event also finalises the one before", async () => {
    const { hook, recognition } = await startSession();

    recognition.hear(final("3x10 back squat"), interim("5x5 deadlift"));

    expect(onResult).toHaveBeenCalledWith("3x10 back squat");
    expect(hook.result.current.interimTranscript).toBe("5x5 deadlift");
  });

  it("stops with stop() and still takes the final result the recogniser returns afterwards", async () => {
    const { hook, recognition } = await startSession();
    recognition.hear(final("3x10 back squat"), interim("5x5 dead"));

    act(() => {
      hook.result.current.stopListening();
    });

    expect(recognition.stop).toHaveBeenCalledTimes(1);
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(hook.result.current.isListening).toBe(false);

    recognition.hear(final("5x5 deadlift"));
    recognition.end();

    expect(onResult.mock.calls).toEqual([["3x10 back squat"], ["5x5 deadlift"]]);
  });

  it("commits the phrase on screen when the stopped recogniser ends without finalising it", async () => {
    const { hook, recognition } = await startSession();
    recognition.hear(final("3x10 back squat"), interim("5x5 deadlift"));

    act(() => {
      hook.result.current.stopListening();
    });
    recognition.end();

    expect(onResult.mock.calls).toEqual([["3x10 back squat"], ["5x5 deadlift"]]);
    expect(hook.result.current.interimTranscript).toBe("");
  });

  it("calls onStopped once the stopped recogniser's last result is in, and ignores anything after", async () => {
    const { hook, recognition } = await startSession();
    const onStopped = vi.fn(() => {
      expect(onResult).toHaveBeenLastCalledWith("5x5 deadlift");
    });

    act(() => {
      hook.result.current.stopListening(onStopped);
    });
    recognition.hear(final("5x5 deadlift"));
    expect(onStopped).not.toHaveBeenCalled();

    recognition.end();
    expect(onStopped).toHaveBeenCalledTimes(1);

    recognition.hear(final("did you see the game last night"));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("cuts off a stopped recogniser that never ends and commits the words on screen", async () => {
    const { hook, recognition } = await startSession();
    recognition.hear(interim("5x5 deadlift"));
    vi.useFakeTimers();
    const onStopped = vi.fn();

    act(() => {
      hook.result.current.stopListening(onStopped);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("5x5 deadlift");
    expect(onStopped).toHaveBeenCalledTimes(1);
  });

  it("calls onStopped at once when nothing is running, including after the recogniser ended by itself", async () => {
    const { hook, recognition } = await startSession();
    recognition.end();
    const onStopped = vi.fn();

    act(() => {
      hook.result.current.stopListening(onStopped);
    });

    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(recognition.stop).not.toHaveBeenCalled();
  });

  it("calls onStopped at once when the recogniser is waiting out a retry", async () => {
    const { hook, recognition } = await startSession();
    vi.useFakeTimers();
    recognition.fail("no-speech");
    recognition.end();
    const onStopped = vi.fn();

    act(() => {
      hook.result.current.stopListening(onStopped);
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("settles a stop still in flight when dictation restarts, keeping the new session clear of it", async () => {
    const { hook, recognition: first } = await startSession();
    first.hear(interim("5x5 deadlift"));
    const onStopped = vi.fn();
    act(() => {
      hook.result.current.stopListening(onStopped);
    });

    await act(async () => {
      await hook.result.current.startListening();
    });

    expect(onResult).toHaveBeenCalledWith("5x5 deadlift");
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(first.abort).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances).toHaveLength(2);

    first.end();
    expect(hook.result.current.isListening).toBe(true);
  });
});

/** Holds getUserMedia open, as a permission prompt does, until grant() is called. */
function holdMicProbe() {
  const track = { stop: vi.fn() };
  const prompt: { grant?: () => void } = {};
  const answered = new Promise<{ getTracks: () => (typeof track)[] }>((resolve) => {
    prompt.grant = () => resolve({ getTracks: () => [track] });
  });
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(() => answered) },
  });
  return { track, grant: () => prompt.grant?.() };
}

// P10 (CODEBASE_ANALYSIS_2026-10-03): a start still waiting on the mic probe
// went live after a stop or an unmount, with nothing on screen showing it.
describe("useSpeechRecognitionSession start while the mic probe is pending (P10)", () => {
  beforeEach(() => {
    onResult.mockReset();
    FakeRecognition.instances.length = 0;
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.navigator, "mediaDevices");
  });

  it("does not open the mic when dictation is stopped before the probe answers", async () => {
    const probe = holdMicProbe();
    const hook = renderHook(() => useSpeechRecognitionSession({ onResult }));
    const starting = hook.result.current.startListening();
    const onStopped = vi.fn();

    act(() => {
      hook.result.current.stopListening(onStopped);
    });
    probe.grant();
    await act(async () => {
      await starting;
    });

    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(hook.result.current.isListening).toBe(false);
    expect(probe.track.stop).toHaveBeenCalledTimes(1);
  });

  it("does not open the mic when the component unmounts before the probe answers", async () => {
    const probe = holdMicProbe();
    const hook = renderHook(() => useSpeechRecognitionSession({ onResult }));
    const starting = hook.result.current.startListening();

    hook.unmount();
    probe.grant();
    await starting;

    expect(FakeRecognition.instances).toHaveLength(0);
    expect(probe.track.stop).toHaveBeenCalledTimes(1);
  });

  it("opens the mic once when dictation is started twice before the probe answers", async () => {
    const probe = holdMicProbe();
    const hook = renderHook(() => useSpeechRecognitionSession({ onResult }));
    const first = hook.result.current.startListening();
    const second = hook.result.current.startListening();

    probe.grant();
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(FakeRecognition.instances).toHaveLength(1);
    expect(hook.result.current.isListening).toBe(true);
  });

  it("still opens the mic once the probe answers when nothing intervened", async () => {
    const probe = holdMicProbe();
    const hook = renderHook(() => useSpeechRecognitionSession({ onResult }));
    const starting = hook.result.current.startListening();

    probe.grant();
    await act(async () => {
      await starting;
    });

    expect(FakeRecognition.instances).toHaveLength(1);
    expect(hook.result.current.isListening).toBe(true);
  });
});
