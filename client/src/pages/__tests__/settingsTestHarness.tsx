import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import Settings from "../Settings";

// Shared harness for the Settings page specs. Mirrors timelineTestHarness:
// the vi.mock graph and render/seed helpers live here so multiple specs reuse
// one setup instead of each duplicating ~60 lines of identical mocks.
//
// Plain object (not vi.hoisted): the mock factories below close over it and
// only read its members lazily — at render/call time — by which point the
// module has fully initialised. Specs assert against these spies directly
// (e.g. settingsHarness.updatePreferences) rather than importing "@/lib/api".
export const settingsHarness = {
  setLocation: vi.fn(),
  updatePreferences: vi.fn<(payload: unknown) => Promise<unknown>>(),
};

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", settingsHarness.setLocation],
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
  // Forward lazily so specs control/assert via settingsHarness.updatePreferences.
  api: {
    preferences: { update: (payload: unknown) => settingsHarness.updatePreferences(payload) },
  },
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

export function seedSettings(qc: QueryClient, preferences: Record<string, unknown>) {
  seedQuery(qc, ["preferences"], preferences);
  seedQuery(qc, ["strava"], null);
  seedQuery(qc, ["garmin"], null);
}

export function renderSettings(qc: QueryClient, sibling?: ReactNode) {
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
      {sibling}
    </QueryClientProvider>,
  );
}

export async function chooseSelectOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

// Settings is split into tabs; Radix unmounts the inactive panels, so a spec
// must activate the owning tab before its fields exist in the DOM. The global
// save bar lives outside the tabs and stays reachable regardless.
export async function goToSettingsTab(
  id: "account" | "training" | "integrations" | "notifications" | "data",
) {
  // Radix Tabs activate on focus (automatic activation), which fireEvent.click
  // doesn't dispatch in jsdom — userEvent does, so the panel actually switches.
  await userEvent.click(await screen.findByTestId(`tab-${id}`));
}

export function defaultSettings() {
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
  };
}

export function seedDefaultSettings(qc: QueryClient) {
  seedSettings(qc, defaultSettings());
}

export async function makeSettingsDirty() {
  await goToSettingsTab("training");
  fireEvent.click(await screen.findByTestId("select-weekly-goal"));
  fireEvent.click(await screen.findByRole("option", { name: "6" }));
  expect(await screen.findByTestId("button-save-settings")).toBeInTheDocument();
}
