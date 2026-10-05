import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordServerConsent } from "@/lib/api/consent";
import { isErrorReportingEnabled } from "@/lib/errorReportingConsent";

import { ErrorReportingConsentCard } from "./ErrorReportingConsentCard";

vi.mock("@/lib/api/consent", () => ({
  recordServerConsent: vi.fn(() => Promise.resolve()),
}));

const ERROR_REPORTING_CONSENT_KEY = "fitai-error-reporting-consent-v1";

function toggle() {
  fireEvent.click(screen.getByTestId("switch-error-reporting-consent"));
}

// P9 (CODEBASE_ANALYSIS_2026-10-03): the Settings toggle only wrote the
// browser flag, so a Settings opt-out after a banner Accept left the server's
// user_consents audit row reading granted.
describe("ErrorReportingConsentCard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(recordServerConsent).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("records an opt-out with the server as well as in the browser", () => {
    render(<ErrorReportingConsentCard />);

    toggle();

    expect(localStorage.getItem(ERROR_REPORTING_CONSENT_KEY)).toBe("off");
    expect(recordServerConsent).toHaveBeenCalledExactlyOnceWith("error_reporting", false);
  });

  it("records an opt-in with the server", () => {
    localStorage.setItem(ERROR_REPORTING_CONSENT_KEY, "off");
    render(<ErrorReportingConsentCard />);

    toggle();

    expect(isErrorReportingEnabled()).toBe(true);
    expect(recordServerConsent).toHaveBeenCalledExactlyOnceWith("error_reporting", true);
  });

  it("applies the toggle without waiting for the server record", () => {
    const pending: { settle?: () => void } = {};
    vi.mocked(recordServerConsent).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        pending.settle = resolve;
      }),
    );
    render(<ErrorReportingConsentCard />);

    toggle();

    expect(screen.getByTestId("switch-error-reporting-consent")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(isErrorReportingEnabled()).toBe(false);
    pending.settle?.();
  });

  it("keeps the toggle working when the server record fails", () => {
    vi.mocked(recordServerConsent).mockRejectedValueOnce(new Error("offline"));
    render(<ErrorReportingConsentCard />);

    toggle();

    expect(screen.getByTestId("switch-error-reporting-consent")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
