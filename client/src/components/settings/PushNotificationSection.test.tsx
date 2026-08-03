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
  QUERY_KEYS: { preferences: ["/api/v1/preferences"] },
}));

vi.mock("@/lib/featureFlags", () => ({
  featureFlags: { nutritionEnabled: true, emomBuilderEnabled: false },
}));

function renderSection(prefs: Record<string, unknown> | undefined = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (prefs) {
    queryClient.setQueryData(
      ["/api/v1/preferences"],
      { pushRefuelReminder: false, pushLoggingReminder: false, ...prefs },
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

  it("shows both reminder toggles reflecting saved preferences", () => {
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
