import { describe, expect, it } from "vitest";

import { CHAT_GENERIC_FAILURE, describeChatFailure } from "./chatErrors";
import { AiBudgetExceededError, RateLimitError } from "./queryClient";
import { SSEStreamError } from "./sseStream";

describe("describeChatFailure", () => {
  it("treats an AbortError as the athlete pressing Stop", () => {
    expect(describeChatFailure(new DOMException("Stream aborted", "AbortError"))).toEqual({
      aborted: true,
      message: "Stopped.",
      retryable: false,
    });
  });

  it("shows the server's reason for a named stream ending", () => {
    const failure = describeChatFailure(
      new SSEStreamError("timeout", "The response took too long and was stopped."),
    );
    expect(failure).toEqual({
      aborted: false,
      message: "The response took too long and was stopped.",
      retryable: true,
    });
  });

  it("offers no retry when the session expired mid-stream", () => {
    const failure = describeChatFailure(
      new SSEStreamError("auth-expired", "Your session expired — please sign in again."),
    );
    expect(failure.message).toBe("Your session expired — please sign in again.");
    expect(failure.retryable).toBe(false);
  });

  it("falls back to the generic copy for a stream error without a reason", () => {
    expect(describeChatFailure(new SSEStreamError("Stream error"))).toEqual({
      aborted: false,
      message: CHAT_GENERIC_FAILURE,
      retryable: true,
    });
  });

  it("names the daily AI limit and offers no retry", () => {
    const failure = describeChatFailure(new AiBudgetExceededError("limit", 210, 200));
    expect(failure.message).toMatch(/daily AI usage limit/i);
    expect(failure.retryable).toBe(false);
  });

  it("names the rate limit, with the wait when the server gave one, and offers a retry", () => {
    const failure = describeChatFailure(new RateLimitError("Too many requests", 12));
    expect(failure.message).toBe(
      "You're sending messages too quickly. Please wait about 12 seconds and try again.",
    );
    expect(failure.retryable).toBe(true);
  });

  it("explains a slow start separately from a dropped connection", () => {
    expect(describeChatFailure(new DOMException("Request timed out", "TimeoutError")).message).toMatch(
      /took too long/i,
    );
    expect(describeChatFailure(new TypeError("Failed to fetch"))).toEqual({
      aborted: false,
      message: "Your connection dropped. Check your internet and try again.",
      retryable: true,
    });
  });

  it("shows the server's own message for a refused request, without a retry", () => {
    const consentOff = describeChatFailure(
      new Error(
        '403: {"error":"AI coaching is disabled for this account. Enable it in Settings before using AI features.","code":"AI_COACH_DISABLED"}',
      ),
    );
    expect(consentOff.message).toMatch(/AI coaching is disabled/);
    expect(consentOff.retryable).toBe(false);

    const tooLong = describeChatFailure(
      new Error('400: {"code":"VALIDATION_ERROR","message":"Message must be 1000 characters or less"}'),
    );
    expect(tooLong.message).toBe("Message must be 1000 characters or less");
    expect(tooLong.retryable).toBe(false);
  });

  it("never shows a 5xx body, but names the two known unavailable states", () => {
    const opaque = describeChatFailure(new Error('500: {"error":"db exploded at row 7"}'));
    expect(opaque).toEqual({ aborted: false, message: CHAT_GENERIC_FAILURE, retryable: true });

    const killSwitch = describeChatFailure(
      new Error('503: {"error":"AI features are temporarily disabled.","code":"AI_FEATURES_DISABLED"}'),
    );
    expect(killSwitch.message).toMatch(/switched off/i);
    expect(killSwitch.retryable).toBe(false);

    const busy = describeChatFailure(
      new Error('503: {"error":"busy","code":"AI_GLOBAL_BUDGET_EXCEEDED"}'),
    );
    expect(busy.message).toMatch(/very busy/i);
    expect(busy.retryable).toBe(false);
  });

  it("says a photo couldn't be read, and offers a retry", () => {
    const unreadable = describeChatFailure(
      new Error('502: {"error":"Couldn\'t read that photo.","code":"CHAT_PHOTO_UNREADABLE"}'),
    );
    expect(unreadable).toEqual({
      aborted: false,
      message: "Couldn't read that photo. Try again, or say what it shows.",
      retryable: true,
    });
  });

  it("uses the generic copy for anything unrecognised", () => {
    expect(describeChatFailure(new Error("No response body")).message).toBe(CHAT_GENERIC_FAILURE);
    expect(describeChatFailure("a thrown string").message).toBe(CHAT_GENERIC_FAILURE);
  });
});
