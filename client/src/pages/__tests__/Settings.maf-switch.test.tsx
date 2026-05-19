import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Settings MAF style switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

    expect(mocks.setLocation).toHaveBeenCalledWith("/?onboarding=run");
    expect(api.preferences.update).not.toHaveBeenCalledWith({ onboardingCompleted: false });
  });
});
