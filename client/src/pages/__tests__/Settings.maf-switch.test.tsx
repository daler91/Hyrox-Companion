import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import Settings from "../Settings";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", mocks.setLocation],
  useSearch: () => "",
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["preferences"],
    stravaStatus: ["strava"],
    garminStatus: ["garmin"],
    authUser: ["auth"],
  },
  api: { preferences: { update: vi.fn() } },
}));
vi.mock("@/components/settings/AccountDangerZone", () => ({ AccountDangerZone: () => null }));
vi.mock("@/components/settings/CoachingSection", () => ({ CoachingSection: () => null }));
vi.mock("@/components/settings/DataToolsSection", () => ({ DataToolsSection: () => null }));
vi.mock("@/components/settings/GarminSection", () => ({ GarminSection: () => null }));
vi.mock("@/components/settings/ProfileSection", () => ({ ProfileSection: () => null }));
vi.mock("@/components/settings/PushNotificationSection", () => ({
  PushNotificationSection: () => null,
}));
vi.mock("@/components/settings/StravaSection", () => ({ StravaSection: () => null }));

installRadixPointerMocks();

function seedQuery<T>(qc: QueryClient, key: readonly string[], data: T) {
  qc.setQueryDefaults(key, {
    queryFn: () => Promise.resolve(data),
    staleTime: Infinity,
  });
  qc.setQueryData(key, data);
}

async function chooseSelectOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function seedDefaultSettings(qc: QueryClient) {
  seedQuery(qc, ["preferences"], {
    weightUnit: "kg",
    distanceUnit: "km",
    weeklyGoal: 5,
    emailNotifications: false,
    emailWeeklySummary: false,
    emailMissedReminder: false,
    showAdherenceInsights: true,
    aiCoachEnabled: false,
    trainingStyleId: "balanced_default",
    onboardingCompleted: true,
    mafAge: null,
    mafConsistency: null,
    mafTrend: null,
  });
  seedQuery(qc, ["strava"], null);
  seedQuery(qc, ["garmin"], null);
}

async function makeSettingsDirty() {
  fireEvent.click(await screen.findByTestId("select-weekly-goal"));
  fireEvent.click(await screen.findByRole("option", { name: "6" }));
  expect(await screen.findByTestId("button-save-settings")).toBeInTheDocument();
}

describe("Settings MAF style switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/settings");
  });

  it("hydrates nullable opt-in preferences as off", async () => {
    const qc = new QueryClient();
    seedQuery(qc, ["preferences"], {
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
    seedQuery(qc, ["strava"], null);
    seedQuery(qc, ["garmin"], null);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

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
    seedQuery(qc, ["preferences"], {
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
    seedQuery(qc, ["strava"], null);
    seedQuery(qc, ["garmin"], null);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

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
    seedQuery(qc, ["preferences"], {
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
    seedQuery(qc, ["strava"], null);
    seedQuery(qc, ["garmin"], null);

    vi.mocked(api.preferences.update).mockResolvedValue({} as Awaited<
      ReturnType<typeof api.preferences.update>
    >);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

    const balancedLabels = await screen.findAllByText("Balanced");
    fireEvent.click(balancedLabels[0]);
    fireEvent.click(await screen.findByText("MAF Method"));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
    expect(screen.getByText("Consistency")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getByText("HR data available")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "39" } });
    await chooseSelectOption("Consistency", "Moderate");
    await chooseSelectOption("Trend", "Flat");
    await chooseSelectOption("HR data available", "Yes");

    expect(api.preferences.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save MAF setup" }));

    expect(await screen.findByTestId("button-save-settings")).toBeInTheDocument();
    expect(api.preferences.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save-settings"));

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith(
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
    seedQuery(qc, ["preferences"], {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: false,
      emailWeeklySummary: false,
      emailMissedReminder: false,
      showAdherenceInsights: true,
      aiCoachEnabled: false,
      trainingStyleId: "balanced_default",
      onboardingCompleted: true,
      mafAge: null,
      mafConsistency: null,
      mafTrend: null,
    });
    seedQuery(qc, ["strava"], null);
    seedQuery(qc, ["garmin"], null);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("button-rerun-onboarding"));

    expect(mocks.setLocation).toHaveBeenCalledWith("/?onboarding=run", undefined);
    expect(api.preferences.update).not.toHaveBeenCalledWith({ onboardingCompleted: false });
  });

  it("prompts before following same-origin links with unsaved settings", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    render(
      <QueryClientProvider client={qc}>
        <>
          <Settings />
          <a href="/analytics">Analytics link</a>
        </>
      </QueryClientProvider>,
    );

    await makeSettingsDirty();

    fireEvent.click(screen.getByText("Analytics link"));

    expect(
      await screen.findByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    expect(mocks.setLocation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Discard unsaved changes?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("button-save-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Analytics link"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(mocks.setLocation).toHaveBeenCalledWith("/analytics", undefined);
  }, 10_000);

  it("prompts before Settings-owned programmatic navigation while dirty", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

    await makeSettingsDirty();

    fireEvent.click(screen.getByTestId("button-rerun-onboarding"));

    expect(
      await screen.findByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeInTheDocument();
    expect(mocks.setLocation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Discard unsaved changes?" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("button-save-settings")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-rerun-onboarding"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(mocks.setLocation).toHaveBeenCalledWith("/?onboarding=run", undefined);
  }, 10_000);

  it("prompts on browser back or forward while settings are dirty", async () => {
    const qc = new QueryClient();
    seedDefaultSettings(qc);

    render(
      <QueryClientProvider client={qc}>
        <Settings />
      </QueryClientProvider>,
    );

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

    expect(mocks.setLocation).toHaveBeenCalledWith("/analytics", undefined);
  }, 10_000);
});
