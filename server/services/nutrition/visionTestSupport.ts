import { expect, vi } from "vitest";

/**
 * Shared Gemini vision-call spies for the meal/label parser specs. `vi.mock` is
 * hoisted so each spec must still declare its own
 * `vi.mock("../../gemini/client", ...)`, but the factory body delegates to
 * {@link makeGeminiClientMock} so the mocked surface is defined once. The spies
 * live at module level so the mock factory and the spec's assertions share one
 * instance (each spec file gets its own module registry, so they never leak
 * across files); `vi.clearAllMocks()` resets them like any other `vi.fn()`.
 */

export const generateContentSpy = vi.fn();
export const trackUsageSpy = vi.fn();

/** Mocked `server/gemini/client` surface: retryWithBackoff runs the fn so the
 *  spy is invoked with the constructed request. */
export function makeGeminiClientMock() {
  return {
    GEMINI_VISION_MODEL: "gemini-2.5-flash",
    getAiClient: () => ({ models: { generateContent: generateContentSpy } }),
    retryWithBackoff: (fn: (signal?: AbortSignal) => Promise<unknown>) => fn(),
    trackUsageFromResponse: trackUsageSpy,
  };
}

export interface VisionCallArgs {
  model: string;
  config: { responseMimeType: string };
  contents: { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[];
}

/**
 * Assert the single vision call carried the base64 under inlineData on the
 * vision model with a JSON contract, and that usage was tracked for the call
 * (before any empty-response check). Returns the request for extra assertions.
 */
export function expectVisionRequest(
  imageBase64: string,
  mimeType: string,
  userId: string,
): VisionCallArgs {
  expect(generateContentSpy).toHaveBeenCalledTimes(1);
  const callArgs = generateContentSpy.mock.calls[0][0] as VisionCallArgs;
  expect(callArgs.model).toBe("gemini-2.5-flash");
  expect(callArgs.config.responseMimeType).toBe("application/json");
  expect(callArgs.contents[0].parts[0]).toEqual({
    inlineData: { mimeType, data: imageBase64 },
  });
  expect(trackUsageSpy).toHaveBeenCalledWith(userId, "gemini-2.5-flash", "parse", expect.anything());
  return callArgs;
}
