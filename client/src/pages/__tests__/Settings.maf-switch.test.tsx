import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Settings from "../Settings";

vi.mock("wouter", () => ({ useLocation: () => ["/settings", vi.fn()], useSearch: () => "" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: { preferences: ["preferences"], stravaStatus: ["strava"], garminStatus: ["garmin"], authUser: ["auth"] },
  api: { preferences: { update: vi.fn() } },
}));

describe("Settings MAF style switch", () => {
  it("blocks switching to MAF and opens setup modal when required fields are missing", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["preferences"], {
      weightUnit: "kg", distanceUnit: "km", weeklyGoal: 5, emailNotifications: true, emailWeeklySummary: true, emailMissedReminder: true,
      showAdherenceInsights: true, aiCoachEnabled: true, trainingStyleId: "balanced_default", mafAge: null, mafConsistency: null, mafTrend: null,
    });
    qc.setQueryData(["strava"], null);
    qc.setQueryData(["garmin"], null);

    render(<QueryClientProvider client={qc}><Settings /></QueryClientProvider>);

    fireEvent.click(screen.getAllByText("Balanced")[0]);
    fireEvent.click(screen.getByText("MAF Method"));
    fireEvent.click(await screen.findByText("Confirm"));

    expect(await screen.findByText("Complete MAF setup")).toBeInTheDocument();
    expect(screen.getByTestId("maf-switch-blocked").textContent).toContain("Complete MAF setup to switch styles");
  });
});
