import { describe, expect, it } from "vitest";

import { isPlanOverlapError, photoParseErrorToast, planOverlapToast } from "./sharedToasts";

// CH-toasts (REFACTORING_REVIEW 2026-09-23): the copy the workout and plan-day
// photo parses, and the plan restore paths, used to write out separately.
describe("photoParseErrorToast", () => {
  it.each([
    ["a client timeout", new Error("Request timed out")],
    ["a timeout error's name in the message", new Error("TimeoutError: signal timed out")],
    ["an abort", new Error("AbortError: The operation was aborted")],
  ])("says the parse may still finish for %s", (_name, error) => {
    expect(photoParseErrorToast(error)).toEqual({
      title: "Parsing took too long — please retry.",
      description: "The image may still finish in the background. Refresh to check before retaking.",
    });
  });

  it.each([
    ["a server error", new Error('500: {"error":"boom"}')],
    ["a thrown string", "Request timed out"],
  ])("asks for a clearer shot for %s", (_name, error) => {
    expect(photoParseErrorToast(error)).toEqual({ title: "Couldn't parse that photo — try a clearer shot." });
  });
});

describe("isPlanOverlapError", () => {
  it("recognises the code and the server's wording", () => {
    expect(isPlanOverlapError('409: {"code":"PLAN_OVERLAP"}')).toBe(true);
    expect(isPlanOverlapError("Another plan already covers these dates")).toBe(true);
    expect(isPlanOverlapError('409: {"code":"RECYCLE_BIN_CONFLICT"}')).toBe(false);
  });

  it("pairs with the restore copy", () => {
    expect(planOverlapToast()).toEqual({
      title: "Can't restore this plan yet",
      description: "Another plan already covers these dates. Archive that one first.",
    });
  });
});
