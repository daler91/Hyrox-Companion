import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { type PlanDayLink, WorkoutPlanDayPicker } from "../WorkoutPlanDayPicker";

vi.mock("@/lib/api", () => ({
  api: { plans: { list: vi.fn(), get: vi.fn() } },
  QUERY_KEYS: { plans: ["plans"], plan: (id: string) => ["plan", id] },
}));

installRadixPointerMocks();

const PLAN = { id: "plan-1", name: "Plan A", totalWeeks: 8 };
const SCHEDULED_DAY = {
  id: "day-1",
  planId: "plan-1",
  weekNumber: 1,
  dayName: "Monday",
  focus: "Engine",
  scheduledDate: "2026-05-01",
  status: "planned",
};
const UNSCHEDULED_DAY = {
  id: "day-2",
  planId: "plan-1",
  weekNumber: 1,
  dayName: "Tuesday",
  focus: "Strength",
  scheduledDate: null,
  status: "planned",
};

function renderPicker(props: {
  planId: string | null;
  planDayId: string | null;
  onChange: (next: PlanDayLink) => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<WorkoutPlanDayPicker {...props} />, { wrapper });
}

describe("WorkoutPlanDayPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.plans.list).mockResolvedValue([PLAN] as never);
    vi.mocked(api.plans.get).mockResolvedValue({ ...PLAN, days: [SCHEDULED_DAY, UNSCHEDULED_DAY] } as never);
  });

  it("cascades plan -> scheduled day and emits the link only when a day is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker({ planId: null, planDayId: null, onChange });

    await user.click(await screen.findByRole("combobox", { name: /select training plan/i }));
    await user.click(await screen.findByRole("option", { name: /Plan A \(8 weeks\)/i }));

    // Picking a plan narrows the day list but must NOT commit a half-selection.
    expect(onChange).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("combobox", { name: /select plan day/i }));
    // Unscheduled days are filtered out (they don't appear on the timeline).
    expect(screen.queryByRole("option", { name: /Tuesday/i })).toBeNull();
    await user.click(await screen.findByRole("option", { name: /Week 1 · Monday · Engine/i }));

    expect(onChange).toHaveBeenCalledWith({ planId: "plan-1", planDayId: "day-1" });
  });

  it("clears the link when 'No plan' is chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker({ planId: "plan-1", planDayId: "day-1", onChange });

    await user.click(await screen.findByRole("combobox", { name: /select training plan/i }));
    await user.click(await screen.findByRole("option", { name: /^No plan$/i }));

    expect(onChange).toHaveBeenCalledWith({ planId: null, planDayId: null });
  });

  it("shows an empty state when the user has no plans", async () => {
    vi.mocked(api.plans.list).mockResolvedValue([] as never);
    renderPicker({ planId: null, planDayId: null, onChange: vi.fn() });

    expect(await screen.findByTestId("workout-plan-empty")).toBeTruthy();
  });

  // S23 — deleting a plan sets workout.planId to null (FK onDelete:"set null").
  // The picker must render that orphaned workout gracefully — defaulting to
  // "No plan" with no dangling day sub-picker — rather than crashing on the
  // missing reference.
  it("renders an orphaned (planId null) workout without crashing", async () => {
    renderPicker({ planId: null, planDayId: null, onChange: vi.fn() });

    const planSelect = await screen.findByRole("combobox", { name: /select training plan/i });
    expect(planSelect).toHaveTextContent(/no plan/i);
    // The day sub-picker only appears once a plan is selected.
    expect(screen.queryByRole("combobox", { name: /select plan day/i })).toBeNull();
  });
});
