import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseSelectOption,
  defaultSettings,
  goToSettingsTab,
  makeSettingsDirty,
  renderSettings,
  seedDefaultSettings,
  seedSettings,
  settingsHarness,
} from "./settingsTestHarness";

/** Seed a balanced-style athlete whose MAF setup fields are still unset. */
function seedBalancedWithoutMafSetup(qc: QueryClient, over: Record<string, unknown> = {}) {
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
    mafCategory: null,
    ...over,
  });
}

/** Pick MAF Method over Balanced, confirm, and wait for the setup modal. */
async function switchStyleToMaf() {
  const balancedLabels = await screen.findAllByText("Balanced");
  fireEvent.click(balancedLabels[0]);
  fireEvent.click(await screen.findByText("MAF Method"));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

  expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
}

/**
 * Trigger a navigation attempt while dirty, expect the discard prompt, cancel
 * it, and confirm we stayed on Settings with the unsaved draft intact.
 */
async function expectDiscardPromptThenCancel(triggerNavigation: () => void) {
  triggerNavigation();

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
}

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
    mafCategory: null,
    });
    renderSettings(qc);

    // Email switches live on the Notifications tab; the AI-coach switch on
    // Training. Assert each on its own tab (inactive panels are unmounted).
    await goToSettingsTab("notifications");
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

    await goToSettingsTab("training");
    expect(await screen.findByTestId("switch-ai-coach-enabled")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("blocks switching to MAF and opens setup modal when required fields are missing", async () => {
    const qc = new QueryClient();
    seedBalancedWithoutMafSetup(qc);
    renderSettings(qc);
    await goToSettingsTab("training");

    await switchStyleToMaf();
    await waitFor(() => {
      expect(screen.getByTestId("maf-switch-blocked")).toHaveTextContent(
        "Complete MAF setup to switch styles",
      );
    });
  }, 10_000);

  it("stages MAF setup locally and persists it only from Save Settings", async () => {
    const qc = new QueryClient();
    seedBalancedWithoutMafSetup(qc, { mafHrDataAvailable: null });

    vi.mocked(settingsHarness.updatePreferences).mockResolvedValue({});

    renderSettings(qc);
    await goToSettingsTab("training");

    await switchStyleToMaf();
    // Target the MAF age input directly: the Race-profile card also renders an
    // "Age" label (W17), so a bare getByText("Age") is ambiguous here.
    expect(screen.getByTestId("maf-age-input")).toBeInTheDocument();
    expect(screen.getByText("Health and training category")).toBeInTheDocument();
    expect(screen.getByText("HR data available")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("maf-age-input"), { target: { value: "39" } });
    await chooseSelectOption(
      "Health and training category",
      "Training consistently (up to 2 years) without those problems",
    );
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
          mafCategory: "consistent_up_to_2y",
          mafHrDataAvailable: true,
        }),
      );
    });
    // The legacy proxy fields are OMITTED from the payload, not nulled: a save
    // must never disturb an older account's stored answers (audit M6).
    const savedPayload = vi.mocked(settingsHarness.updatePreferences).mock.calls.at(-1)![0];
    expect(savedPayload).not.toHaveProperty("mafConsistency");
    expect(savedPayload).not.toHaveProperty("mafTrend");
    expect(savedPayload).not.toHaveProperty("mafInjuryIllnessMedication");
  }, 10_000);

  it("lets a recovered athlete change the category that was costing 10 bpm of ceiling", async () => {
    // The same guarantee the old injury-flag test pinned, on the category
    // surface: an answer that lowers the ceiling must never be write-once. An
    // athlete who answered "recovering from major illness" (-10) and has since
    // recovered re-answers Maffetone's question and the save carries it.
    const qc = new QueryClient();
    seedSettings(qc, {
      ...defaultSettings(),
      trainingStyleId: "maf_method",
      mafAge: 39,
      mafCategory: "recovering_or_medicated",
      mafHrDataAvailable: true,
    });
    vi.mocked(settingsHarness.updatePreferences).mockResolvedValue({});

    renderSettings(qc);
    await goToSettingsTab("training");

    fireEvent.click(await screen.findByTestId("button-maf-setup"));
    await chooseSelectOption(
      "Health and training category",
      "Training consistently (up to 2 years) without those problems",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save MAF setup" }));
    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(settingsHarness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mafCategory: "consistent_up_to_2y" }),
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

    await expectDiscardPromptThenCancel(() => {
      fireEvent.click(screen.getByText("Analytics link"));
    });

    fireEvent.click(screen.getByText("Analytics link"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(settingsHarness.setLocation).toHaveBeenCalledWith("/analytics", undefined);
  }, 10_000);

  it("prompts before Settings-owned programmatic navigation while dirty", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    renderSettings(qc);

    await makeSettingsDirty();
    // makeSettingsDirty leaves us on the Training tab; the rerun button lives
    // on the Account tab. Switching tabs keeps the unsaved-changes state.
    await goToSettingsTab("account");

    await expectDiscardPromptThenCancel(() => {
      fireEvent.click(screen.getByTestId("button-rerun-onboarding"));
    });

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
