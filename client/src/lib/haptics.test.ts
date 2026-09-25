import { afterEach, describe, expect, it, vi } from "vitest";

import { haptic } from "./haptics";

describe("haptic", () => {
  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of a property we defined below.
    delete navigator.vibrate;
  });

  it("vibrates with the given pattern when the Vibration API is available", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    haptic([10, 20, 10]);

    expect(vibrate).toHaveBeenCalledWith([10, 20, 10]);
  });

  it("defaults to a short single pulse", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });

    haptic();

    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("is a no-op, not a throw, when the browser has no Vibration API", () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });

    expect(() => haptic()).not.toThrow();
  });

  it("swallows a permissions-policy rejection instead of throwing", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new DOMException("Blocked by permissions policy", "NotAllowedError");
      },
      configurable: true,
    });

    expect(() => haptic()).not.toThrow();
  });
});
