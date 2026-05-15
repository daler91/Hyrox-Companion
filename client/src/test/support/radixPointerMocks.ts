import { afterAll, beforeAll, vi } from "vitest";

const POINTER_METHODS = [
  "hasPointerCapture",
  "setPointerCapture",
  "releasePointerCapture",
  "scrollIntoView",
] as const;

type PointerMethod = (typeof POINTER_METHODS)[number];

export function installRadixPointerMocks(): void {
  const originalMethods = new Map<PointerMethod, unknown>();
  const prototype = HTMLElement.prototype as unknown as Record<PointerMethod, unknown>;

  beforeAll(() => {
    for (const method of POINTER_METHODS) {
      originalMethods.set(method, prototype[method]);
      prototype[method] = method === "hasPointerCapture"
        ? vi.fn().mockReturnValue(false)
        : vi.fn();
    }
  });

  afterAll(() => {
    for (const method of POINTER_METHODS) {
      prototype[method] = originalMethods.get(method);
    }
  });
}
