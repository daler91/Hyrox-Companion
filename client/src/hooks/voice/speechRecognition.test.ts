import { describe, expect, it } from "vitest";

import { requestMicrophoneProbe } from "./speechRecognition";

describe("requestMicrophoneProbe browser-compat guard", () => {
  it("rejects with a clear message when mediaDevices is unavailable", async () => {
    // The test runtime does not implement navigator.mediaDevices (as on an
    // insecure HTTP origin or older browser), so this exercises the guard that
    // replaces a raw "Cannot read properties of undefined" TypeError.
    await expect(requestMicrophoneProbe()).rejects.toThrow(/secure|HTTPS|Microphone/i);
  });
});
