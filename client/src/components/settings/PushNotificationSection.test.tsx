import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { PushNotificationSection } from "./PushNotificationSection";

const pushState = vi.hoisted(() => ({ isSubscribed: true }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: true,
    isSubscribed: pushState.isSubscribed,
    permission: "granted" as NotificationPermission,
    isLoading: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendTestNotification: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: { preferences: { update: vi.fn() } },
  QUERY_KEYS: { preferences: ["/api/v1/preferences"], authUser: ["/api/v1/auth/user"] },
}));

vi.mock("@/lib/featureFlags", () => ({
  featureFlags: { nutritionEnabled: true, emomBuilderEnabled: false },
}));

function renderSection(user: Record<string, unknown> | undefined = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // GET /preferences never carries the reminder switches; the auth user does.
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  if (user) {
    queryClient.setQueryData(
      ["/api/v1/auth/user"],
      { id: "u1", pushRefuelReminder: false, pushLoggingReminder: false, ...user },
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <PushNotificationSection />
    </QueryClientProvider>,
  );
}

describe("PushNotificationSection nutrition reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushState.isSubscribed = true;
  });

  it("shows both reminder toggles as the user record has them", () => {
    renderSection({ pushLoggingReminder: true });
    expect(screen.getByTestId("switch-push-refuel-reminder")).not.toBeChecked();
    expect(screen.getByTestId("switch-push-logging-reminder")).toBeChecked();
  });

  it("saves a toggle change immediately", async () => {
    const user = userEvent.setup();
    vi.mocked(api.preferences.update).mockResolvedValue({} as never);
    renderSection();

    await user.click(screen.getByTestId("switch-push-refuel-reminder"));

    await waitFor(() =>
      expect(api.preferences.update).toHaveBeenCalledWith({ pushRefuelReminder: true }),
    );
  });

  it("hides the reminder toggles while push is not enabled", () => {
    pushState.isSubscribed = false;
    renderSection();
    expect(screen.queryByTestId("switch-push-refuel-reminder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-push-logging-reminder")).not.toBeInTheDocument();
  });
});
