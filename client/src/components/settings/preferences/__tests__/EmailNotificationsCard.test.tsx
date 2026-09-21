import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { EmailNotificationsCard, formatNotifyHourLabel } from "../EmailNotificationsCard";

const AXE_TIMEOUT_MS = 10_000;

function renderCard(overrides: Partial<Parameters<typeof EmailNotificationsCard>[0]> = {}) {
  const handlers = {
    onEmailNotificationsChange: vi.fn(),
    onEmailWeeklySummaryChange: vi.fn(),
    onEmailMissedReminderChange: vi.fn(),
    onEmailWeeklyReviewReminderChange: vi.fn(),
    onEmailTodaySessionChange: vi.fn(),
    onEmailAnalysisDigestChange: vi.fn(),
    onNotifyHourChange: vi.fn(),
  };
  const utils = render(
    <EmailNotificationsCard
      emailNotifications={true}
      emailWeeklySummary={false}
      emailMissedReminder={false}
      emailWeeklyReviewReminder={false}
      emailTodaySession={false}
      emailAnalysisDigest={false}
      notifyHour={7}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, handlers };
}

describe("EmailNotificationsCard", () => {
  it(
    "has no WCAG violations",
    async () => {
      const { container } = renderCard();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
    AXE_TIMEOUT_MS,
  );

  it("renders the master toggle, one switch per email type, and the send-time select", () => {
    renderCard();
    for (const testId of [
      "switch-email-notifications",
      "switch-email-weekly-summary",
      "switch-email-missed-reminder",
      "switch-email-weekly-review-reminder",
      "switch-email-today-session",
      "switch-email-analysis-digest",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.getByTestId("select-notify-hour")).toHaveTextContent("07:00");
  });

  it("disables every per-type switch when the master toggle is off", () => {
    renderCard({ emailNotifications: false });
    for (const testId of [
      "switch-email-weekly-summary",
      "switch-email-missed-reminder",
      "switch-email-weekly-review-reminder",
      "switch-email-today-session",
      "switch-email-analysis-digest",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
    expect(screen.getByTestId("switch-email-notifications")).not.toBeDisabled();
  });

  it("forwards per-type toggles to their own handlers", () => {
    const { handlers } = renderCard();
    fireEvent.click(screen.getByTestId("switch-email-analysis-digest"));
    expect(handlers.onEmailAnalysisDigestChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("switch-email-today-session"));
    expect(handlers.onEmailTodaySessionChange).toHaveBeenCalledWith(true);
    expect(handlers.onEmailWeeklyReviewReminderChange).not.toHaveBeenCalled();
  });

  it("labels hours as zero-padded 24h clock times", () => {
    expect(formatNotifyHourLabel(7)).toBe("07:00");
    expect(formatNotifyHourLabel(0)).toBe("00:00");
    expect(formatNotifyHourLabel(18)).toBe("18:00");
  });
});
