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

function seedSettings(qc: QueryClient, preferences: Record<string, unknown>) {
  seedQuery(qc, ["preferences"], preferences);
  seedQuery(qc, ["strava"], null);
  seedQuery(qc, ["garmin"], null);
}

function renderSettings(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  );
}

async function chooseSelectOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: "prefer_not_to_say",
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
    mafHrDataAvailable: null,
    ...overrides,
  };
}

describe("Settings race profile persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/settings");
    vi.mocked(api.preferences.update).mockResolvedValue(
      {} as Awaited<ReturnType<typeof api.preferences.update>>,
    );
  });

  // Regression: the Save payload previously omitted `gender`, so a change to
  // the race-profile gender select looked saved (toast + cleared save bar) but
  // never reached the PATCH body. Because the server does a partial update,
  // the value silently reverted to its stored default on the next refetch.
  it("sends the changed gender in the save payload", async () => {
    const qc = new QueryClient();
    seedSettings(qc, baseSettings());
    renderSettings(qc);

    await chooseSelectOption("Select gender", "Men");

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith(
        expect.objectContaining({ gender: "male" }),
      );
    });
  }, 10_000);

  // Sibling field on the same payload line — guard it against the same drop.
  it("sends the changed division in the save payload", async () => {
    const qc = new QueryClient();
    seedSettings(qc, baseSettings());
    renderSettings(qc);

    await chooseSelectOption("Select division", "Pro");

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith(
        expect.objectContaining({ division: "pro" }),
      );
    });
  }, 10_000);

  // The payload always carries the full preference set: an unrelated edit must
  // still forward the seeded gender/division rather than dropping them.
  it("preserves gender and division when an unrelated field changes", async () => {
    const qc = new QueryClient();
    seedSettings(qc, baseSettings({ gender: "female", division: "pro" }));
    renderSettings(qc);

    fireEvent.click(await screen.findByTestId("select-weekly-goal"));
    fireEvent.click(await screen.findByRole("option", { name: "6" }));

    fireEvent.click(await screen.findByTestId("button-save-settings"));

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith(
        expect.objectContaining({ gender: "female", division: "pro", weeklyGoal: 6 }),
      );
    });
  }, 10_000);
});
