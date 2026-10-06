import { act } from "@testing-library/react";
import { vi } from "vitest";

import type { SpeechRecognitionEvent } from "@/hooks/voice/types";

/**
 * A browser speech recogniser driven by the test, shared by the dictation
 * specs (the stepper's Continue, the form's Save). Install it with
 * `vi.stubGlobal("SpeechRecognition", FakeRecognition)` plus
 * `stubMicrophone()`, and read the session a start opened from
 * `FakeRecognition.instances`.
 */

export interface Heard {
  readonly transcript: string;
  readonly isFinal: boolean;
}

export const final = (transcript: string): Heard => ({ transcript, isFinal: true });
export const interim = (transcript: string): Heard => ({ transcript, isFinal: false });

/** stop() only asks it to finish, as in a browser; `end()` is the browser finishing. */
export class FakeRecognition {
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
    const results = heard.map((said) =>
      Object.assign([{ transcript: said.transcript }], { isFinal: said.isFinal }),
    );
    act(() => {
      this.onresult?.({ resultIndex: 0, results } as unknown as SpeechRecognitionEvent);
    });
  }

  end() {
    act(() => {
      this.onend?.();
    });
  }
}

/** A granted microphone, for the permission probe dictation opens with. */
export function stubMicrophone(): void {
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
}

export function unstubMicrophone(): void {
  Reflect.deleteProperty(globalThis.navigator, "mediaDevices");
}
