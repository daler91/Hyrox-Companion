import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionPriorityControl } from "../SessionPriorityControl";

const apiMocks = vi.hoisted(() => ({ setDayPriority: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { plans: apiMocks },
  QUERY_KEYS: { timeline: ["/api/v1/timeline"] },
}));
vi.mock("@/hooks/use-toast", async () => (await import("@/test/support/mutationHookMocks")).makeToastMock());

const entry = {
  id: "plan-pd-1",
  date: "2026-09-26",
  type: "planned",
  status: "planned",
  focus: "Long run",
  mainWorkout: "90 min easy",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
  priority: "key",
} as TimelineEntry;

function renderControl(overrides: Partial<TimelineEntry> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionPriorityControl entry={{ ...entry, ...overrides }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.setDayPriority.mockResolvedValue({ id: "pd-1", priority: "optional" });
});

describe("SessionPriorityControl", () => {
  it("shows the session's tier and what it means", () => {
    renderControl();
    expect(screen.getByTestId("session-priority-key")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("session-priority-plan-pd-1")).toHaveTextContent(
      "The plan is built on it. If it's missed, it's worth fitting back in.",
    );
  });

  it("saves a new tier and shows it straight away", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByTestId("session-priority-optional"));

    expect(screen.getByTestId("session-priority-optional")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(apiMocks.setDayPriority).toHaveBeenCalledWith("pd-1", "optional"));
  });

  it("puts the old tier back if the save fails", async () => {
    apiMocks.setDayPriority.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByTestId("session-priority-supporting"));

    await waitFor(() => expect(screen.getByTestId("session-priority-key")).toHaveAttribute("aria-pressed", "true"));
  });

  it("is absent for a rest day and for a logged session", () => {
    const { container, rerender } = renderControl({ priority: undefined, focus: "Rest" });
    expect(container).toBeEmptyDOMElement();

    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <SessionPriorityControl entry={{ ...entry, status: "completed", workoutLogId: "log-1" }} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("session-priority-plan-pd-1")).toBeNull();
  });
});
