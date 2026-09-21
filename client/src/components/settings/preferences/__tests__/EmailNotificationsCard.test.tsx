import { WEEKLY_REVIEW_SUNDAY_EVENING_HOUR } from "@shared/weeklyReview";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    onNotifyHourWeeklySummaryChange: vi.fn(),
    onNotifyHourMissedReminderChange: vi.fn(),
    onNotifyHourWeeklyReviewReminderChange: vi.fn(),
    onNotifyHourTodaySessionChange: vi.fn(),
    onNotifyHourAnalysisDigestChange: vi.fn(),
  };
  const utils = render(
    <EmailNotificationsCard
      emailNotifications
      emailWeeklySummary={false}
      emailMissedReminder={false}
      emailWeeklyReviewReminder={false}
      emailTodaySession={false}
      emailAnalysisDigest={false}
      notifyHour={7}
      notifyHourWeeklySummary={null}
      notifyHourMissedReminder={null}
      notifyHourWeeklyReviewReminder={null}
      notifyHourTodaySession={null}
      notifyHourAnalysisDigest={null}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, handlers };
}

/** Radix renders its options into a portal only once the trigger is opened. */
function openSelect(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
  return within(screen.getByRole("listbox"));
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

  it("renders the master toggle, one switch per email type, and the default send time", () => {
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

  it("shows a send-time select only for the email types that are switched on", () => {
    renderCard({ emailWeeklySummary: true, emailTodaySession: true });
    expect(screen.getByTestId("select-notify-hour-weekly-summary")).toBeInTheDocument();
    expect(screen.getByTestId("select-notify-hour-today-session")).toBeInTheDocument();
    expect(screen.queryByTestId("select-notify-hour-missed-reminder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-notify-hour-analysis-digest")).not.toBeInTheDocument();
  });

  it("hides the per-type send times while the master toggle is off", () => {
    renderCard({ emailNotifications: false, emailWeeklySummary: true });
    expect(screen.queryByTestId("select-notify-hour-weekly-summary")).not.toBeInTheDocument();
  });

  it("names the default send time each email falls back to when it has no time of its own", () => {
    renderCard({
      notifyHour: 9,
      emailWeeklySummary: true,
      emailWeeklyReviewReminder: true,
    });
    expect(screen.getByTestId("select-notify-hour-weekly-summary")).toHaveTextContent(
      "Default (09:00)",
    );
    // The review reminder's unset moment is Sunday evening, not the default
    // send time the morning emails follow.
    expect(screen.getByTestId("select-notify-hour-weekly-review-reminder")).toHaveTextContent(
      `Default (${formatNotifyHourLabel(WEEKLY_REVIEW_SUNDAY_EVENING_HOUR)})`,
    );
  });

  it("shows an email's own send time once it has one", () => {
    renderCard({ emailMissedReminder: true, notifyHourMissedReminder: 20 });
    expect(screen.getByTestId("select-notify-hour-missed-reminder")).toHaveTextContent("20:00");
  });

  it("reports a picked hour to that email's handler alone", () => {
    const { handlers } = renderCard({ emailAnalysisDigest: true });
    fireEvent.click(openSelect("select-notify-hour-analysis-digest").getByText("19:00"));
    expect(handlers.onNotifyHourAnalysisDigestChange).toHaveBeenCalledWith(19);
    expect(handlers.onNotifyHourChange).not.toHaveBeenCalled();
    expect(handlers.onNotifyHourWeeklySummaryChange).not.toHaveBeenCalled();
  });

  it("reports null when an email is put back on the default send time", () => {
    const { handlers } = renderCard({ emailAnalysisDigest: true, notifyHourAnalysisDigest: 19 });
    fireEvent.click(openSelect("select-notify-hour-analysis-digest").getByText("Default (07:00)"));
    expect(handlers.onNotifyHourAnalysisDigestChange).toHaveBeenCalledWith(null);
  });

  it("says the brief covers tomorrow when its own send time is after midday", () => {
    // The brief's own hour decides this, not the default send time.
    renderCard({ emailTodaySession: true, notifyHourTodaySession: 18, notifyHour: 7 });
    expect(screen.getByText(/tomorrow's planned session/i)).toBeInTheDocument();
  });

  it("says the brief covers today when its own send time is before midday", () => {
    renderCard({ emailTodaySession: true, notifyHourTodaySession: 6, notifyHour: 18 });
    expect(screen.getByText(/the day's planned session/i)).toBeInTheDocument();
  });

  it("reads the default send time for the brief copy when the brief has no hour of its own", () => {
    // Resolved through the same shared helper the scheduler uses, so the copy
    // cannot promise a day the cron would not brief.
    renderCard({ emailTodaySession: true, notifyHourTodaySession: null, notifyHour: 18 });
    expect(screen.getByText(/tomorrow's planned session/i)).toBeInTheDocument();
  });
});
