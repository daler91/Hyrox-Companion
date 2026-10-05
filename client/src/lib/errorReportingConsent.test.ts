import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetErrorReportingConsentSessionForTests,
  disableErrorReporting,
  enableErrorReporting,
  isErrorReportingEnabled,
} from "./errorReportingConsent";

const ERROR_REPORTING_CONSENT_KEY = "fitai-error-reporting-consent-v1";

function denyLocalStorage(): void {
  const deny = () => {
    throw new DOMException("Denied", "SecurityError");
  };
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(deny),
    setItem: vi.fn(deny),
    removeItem: vi.fn(deny),
  });
}

describe("errorReportingConsent", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetErrorReportingConsentSessionForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to enabled and persists an opt-out and a later opt-in", () => {
    expect(isErrorReportingEnabled()).toBe(true);

    disableErrorReporting();
    expect(localStorage.getItem(ERROR_REPORTING_CONSENT_KEY)).toBe("off");
    expect(isErrorReportingEnabled()).toBe(false);

    enableErrorReporting();
    expect(localStorage.getItem(ERROR_REPORTING_CONSENT_KEY)).toBeNull();
    expect(isErrorReportingEnabled()).toBe(true);
  });

  it("does not hold a session decision when storage kept it", () => {
    disableErrorReporting();
    localStorage.clear();

    expect(isErrorReportingEnabled()).toBe(true);
  });

  // P8 (CODEBASE_ANALYSIS_2026-10-03): with storage blocked, an opt-out read
  // back as the default and Sentry started once the notice was acknowledged.
  it("keeps an opt-out storage refused for the rest of the session", () => {
    denyLocalStorage();
    expect(isErrorReportingEnabled()).toBe(true);

    disableErrorReporting();
    expect(isErrorReportingEnabled()).toBe(false);

    enableErrorReporting();
    expect(isErrorReportingEnabled()).toBe(true);
  });

  it("keeps an opt-out when storage reads but will not write", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Full", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
    });

    disableErrorReporting();

    expect(isErrorReportingEnabled()).toBe(false);
  });
});
