import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseSelectOption,
  defaultSettings,
  makeSettingsDirty,
  renderSettings,
  seedDefaultSettings,
  seedSettings,
  settingsHarness,
} from "./settingsTestHarness";

describe("Settings MAF style switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/settings");
  });

  it("hydrates nullable opt-in preferences as off", async () => {
    const qc = new QueryClient();
    seedSettings(qc, {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: null,
      emailWeeklySummary: null,
      emailMissedReminder: null,
      showAdherenceInsights: true,
      aiCoachEnabled: null,
      trainingStyleId: "balanced_default",
      mafAge: null,
      mafConsistency: null,
      mafTrend: null,
    });
    renderSettings(qc);

    expect(await screen.findByTestId("switch-email-notifications")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(screen.getByTestId("switch-email-weekly-summary")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(screen.getByTestId("switch-email-missed-reminder")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
    expect(screen.getByTestId("switch-ai-coach-enabled")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("blocks switching to MAF and opens setup modal when required fields are missing", async () => {
    const qc = new QueryClient();
    seedSettings(qc, {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: true,
      emailWeeklySummary: true,
      emailMissedReminder: true,
      showAdherenceInsights: true,
      aiCoachEnabled: true,
      trainingStyleId: "balanced_default",
      mafAge: null,
      mafConsistency: null,
      mafTrend: null,
    });
    renderSettings(qc);

    const balancedLabels = await screen.findAllByText("Balanced");
    fireEvent.click(balancedLabels[0]);
    fireEvent.click(await screen.findByText("MAF Method"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("maf-switch-blocked")).toHaveTextContent(
        "Complete MAF setup to switch styles",
      );
    });
  }, 10_000);

  it("stages MAF setup locally and persists it only from Save Settings", async () => {
    const qc = new QueryClient();
    seedSettings(qc, {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: true,
      emailWeeklySummary: true,
      emailMissedReminder: true,
      showAdherenceInsights: true,
      aiCoachEnabled: true,
      trainingStyleId: "balanced_default",
      mafAge: null,
      mafConsistency: null,
      mafTrend: null,
      mafHrDataAvailable: null,
    });

    vi.mocked(settingsHarness.updatePreferences).mockResolvedValue({});

    renderSettings(qc);

    const balancedLabels = await screen.findAllByText("Balanced");
    fireEvent.click(balancedLabels[0]);
    fireEvent.click(await screen.findByText("MAF Method"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    // Target the MAF age input directly: the Race-profile card also renders an
    // "Age" label (W17), so a bare getByText("Age") is ambiguous here.
    expect(screen.getByTestId("maf-age-input")).toBeInTheDocument();
    expect(screen.getByText("Consistency")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getByText("HR data available")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("maf-age-input"), { target: { value: "39" } });
    await chooseSelectOption("Consistency", "Moderate");
    await chooseSelectOption("Trend", "Flat");
    await chooseSelectOption("HR data available", "Yes");

    expect(settingsHarness.updatePreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save MAF setup" }));

    expect(await screen.findByTestId("button-save-settings")).toBeInTheDocument();
    expect(settingsHarness.updatePreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save-settings"));

    await waitFor(() => {
      expect(settingsHarness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          trainingStyleId: "maf_method",
          mafAge: 39,
          mafConsistency: "moderate",
          mafTrend: "flat",
          mafHrDataAvailable: true,
        }),
      );
    });
  }, 10_000);

  it("reruns onboarding through the forced URL without changing durable completion", async () => {
    const qc = new QueryClient();
    seedSettings(qc, {
      ...defaultSettings(),
      onboardingCompleted: true,
    });
    renderSettings(qc);

    fireEvent.click(await screen.findByTestId("button-rerun-onboarding"));

    expect(settingsHarness.setLocation).toHaveBeenCalledWith("/?onboarding=run", undefined);
    expect(settingsHarness.updatePreferences).not.toHaveBeenCalledWith({
      onboardingCompleted: false,
    });
  });

  it("prompts before following same-origin links with unsaved settings", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    renderSettings(qc, <a href="/analytics">Analytics link</a>);

    await makeSettingsDirty();

    fireEvent.click(screen.getByText("Analytics link"));

    expect(
      await screen.findByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    expect(settingsHarness.setLocation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Discard unsaved changes?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("button-save-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Analytics link"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(settingsHarness.setLocation).toHaveBeenCalledWith("/analytics", undefined);
  }, 10_000);

  it("prompts before Settings-owned programmatic navigation while dirty", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    renderSettings(qc);

    await makeSettingsDirty();

    fireEvent.click(screen.getByTestId("button-rerun-onboarding"));

    expect(
      await screen.findByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    expect(settingsHarness.setLocation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Discard unsaved changes?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("button-save-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-rerun-onboarding"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(settingsHarness.setLocation).toHaveBeenCalledWith("/?onboarding=run", undefined);
  }, 10_000);

  it("prompts on browser back or forward while settings are dirty", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    renderSettings(qc);

    await makeSettingsDirty();

    act(() => {
      globalThis.history.pushState(null, "", "/analytics");
      globalThis.dispatchEvent(new Event("popstate"));
    });

    expect(
      await screen.findByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    expect(globalThis.location.pathname).toBe("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(settingsHarness.setLocation).toHaveBeenCalledWith("/analytics", undefined);
  }, 10_000);
});
