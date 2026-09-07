import "@testing-library/jest-dom/vitest";

import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";
import { resolveDeviceLinkOptions } from "../timeline-workout-card/DeviceLinkControls";

const apiMocks = vi.hoisted(() => ({
  linkDeviceActivity: vi.fn(),
  unlinkDeviceActivity: vi.fn(),
  dismissDeviceLinkSuggestion: vi.fn(),
}));

// Partial mock: only the three device-link calls are stubbed, so everything
// else the card transitively imports from the API module keeps working.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, workouts: { ...actual.api.workouts, ...apiMocks } },
  };
});

const DATE = "2026-09-08";

const plannedSibling = {
  id: "plan-pd-1",
  date: DATE,
  type: "planned",
  status: "planned",
  focus: "Easy Run",
  mainWorkout: "8 km easy",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
} as unknown as TimelineEntry;

const manualSibling = {
  id: "log-m1",
  date: DATE,
  type: "logged",
  status: "completed",
  focus: "Strength",
  mainWorkout: "Back squat 5x5",
  accessory: null,
  notes: null,
  workoutLogId: "m1",
  source: "manual",
} as unknown as TimelineEntry;

const stravaImport = {
  id: "log-s1",
  date: DATE,
  type: "logged",
  status: "completed",
  focus: "Run",
  mainWorkout: "8.1 km, 45:00",
  accessory: null,
  notes: "Morning Run | Avg HR: 152 bpm",
  workoutLogId: "s1",
  source: "strava",
  stravaActivityId: "9001",
  deviceLinkSource: null,
  deviceActivityName: "Morning Run",
  suggestedPlanDayId: "pd-1",
  suggestedWorkoutLogId: null,
  suggestedLinkConfidence: 0.6,
} as unknown as TimelineEntry;

const enrichedManualLog = {
  id: "log-m2",
  date: DATE,
  type: "logged",
  status: "completed",
  focus: "Tempo Run",
  mainWorkout: "45 min tempo",
  accessory: null,
  notes: null,
  workoutLogId: "m2",
  source: "manual",
  stravaActivityId: "9002",
  deviceLinkSource: "auto",
  deviceActivityName: "Lunch Tempo",
} as unknown as TimelineEntry;

function renderCard(entry: TimelineEntry, dayEntries: TimelineEntry[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }) },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  const onClick = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={entry}
        dayEntries={dayEntries}
        onClick={onClick}
        onMarkComplete={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClick };
}

describe("resolveDeviceLinkOptions", () => {
  it("names the suggested plan day from the day's entries and lists linkable rows", () => {
    const options = resolveDeviceLinkOptions(stravaImport, [
      plannedSibling,
      manualSibling,
      stravaImport,
    ]);
    expect(options.suggestion).toEqual({
      key: "pd-1",
      label: "Easy Run",
      target: { planDayId: "pd-1" },
    });
    expect(options.candidates).toEqual([
      { key: "pd-1", label: "Easy Run", target: { planDayId: "pd-1" } },
      { key: "m1", label: "Strength", target: { workoutLogId: "m1" } },
    ]);
  });

  it("keeps a suggestion readable when its target is not on screen", () => {
    expect(resolveDeviceLinkOptions(stravaImport, []).suggestion?.label).toBe(
      "that planned session",
    );
  });

  it("never offers another device import, a completed plan day, or the entry itself", () => {
    const otherImport = {
      ...stravaImport,
      id: "log-s2",
      workoutLogId: "s2",
      stravaActivityId: "9003",
    } as TimelineEntry;
    const completedDay = {
      ...plannedSibling,
      id: "plan-pd-2",
      planDayId: "pd-2",
      status: "completed",
    } as TimelineEntry;
    const options = resolveDeviceLinkOptions(stravaImport, [
      otherImport,
      completedDay,
      stravaImport,
    ]);
    expect(options.candidates).toEqual([]);
  });
});

describe("TimelineWorkoutCard — device link affordances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.linkDeviceActivity.mockResolvedValue({ id: "m1" });
    apiMocks.unlinkDeviceActivity.mockResolvedValue({ log: null, standalone: { id: "s9" } });
    apiMocks.dismissDeviceLinkSuggestion.mockResolvedValue({ id: "s1" });
  });

  it("asks about the suggested session by name and links it without opening the card", async () => {
    const { onClick } = renderCard(stravaImport, [plannedSibling, stravaImport]);

    const prompt = screen.getByTestId("device-link-suggestion-log-s1");
    expect(prompt).toHaveTextContent("Was this your Easy Run?");

    fireEvent.click(screen.getByTestId("device-link-accept-log-s1"));

    await waitFor(() =>
      expect(apiMocks.linkDeviceActivity).toHaveBeenCalledWith("s1", { planDayId: "pd-1" }),
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it("dismisses the suggestion without opening the card", async () => {
    const { onClick } = renderCard(stravaImport, [plannedSibling, stravaImport]);

    fireEvent.click(screen.getByTestId("device-link-dismiss-log-s1"));

    await waitFor(() => expect(apiMocks.dismissDeviceLinkSuggestion).toHaveBeenCalledWith("s1"));
    expect(apiMocks.linkDeviceActivity).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("unlinks a linked recording from the Strava badge menu", async () => {
    const user = userEvent.setup();
    const { onClick } = renderCard(enrichedManualLog, [enrichedManualLog]);

    expect(screen.queryByTestId("device-link-suggestion-log-m2")).toBeNull();
    await user.click(screen.getByTestId("strava-badge-menu-log-m2"));
    await user.click(await screen.findByTestId("device-unlink-log-m2"));

    await waitFor(() => expect(apiMocks.unlinkDeviceActivity).toHaveBeenCalledWith("m2"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("offers the day's planned session and manual log to an import with no suggestion", async () => {
    const user = userEvent.setup();
    const unsuggested = {
      ...stravaImport,
      suggestedPlanDayId: null,
      suggestedLinkConfidence: null,
    } as TimelineEntry;
    renderCard(unsuggested, [plannedSibling, manualSibling, unsuggested]);

    expect(screen.queryByTestId("device-link-suggestion-log-s1")).toBeNull();
    await user.click(screen.getByTestId("strava-badge-menu-log-s1"));
    expect(await screen.findByTestId("device-link-to-log-s1-pd-1")).toHaveTextContent("Easy Run");
    await user.click(screen.getByTestId("device-link-to-log-s1-m1"));

    await waitFor(() =>
      expect(apiMocks.linkDeviceActivity).toHaveBeenCalledWith("s1", { workoutLogId: "m1" }),
    );
  });

  it("has no automated WCAG violations with the prompt and the badge menu rendered", async () => {
    // The card is itself role="button" and already nests its mark-complete
    // button, coach-note toggle and move menu inside it, each stopping
    // propagation (the a11y test's fixture renders none of them, which is
    // why it passes the rule). These controls follow that same contract, so
    // nested-interactive is the one rule set aside here.
    const options = { rules: { "nested-interactive": { enabled: false } } };
    const { container } = renderCard(stravaImport, [plannedSibling, stravaImport]);
    expect(await axe(container, options)).toHaveNoViolations();

    const linked = renderCard(enrichedManualLog, [enrichedManualLog]);
    expect(await axe(linked.container, options)).toHaveNoViolations();
  });

  it("renders a plain badge when there is nothing to link to", () => {
    const unsuggested = {
      ...stravaImport,
      suggestedPlanDayId: null,
      suggestedLinkConfidence: null,
    } as TimelineEntry;
    renderCard(unsuggested, [unsuggested]);

    expect(screen.getByTestId("badge-strava-log-s1")).toHaveTextContent("Strava");
    expect(screen.queryByTestId("strava-badge-menu-log-s1")).toBeNull();
    expect(screen.queryByTestId("device-link-suggestion-log-s1")).toBeNull();
  });

  it("shows no Strava controls on a plain manual log", () => {
    renderCard(manualSibling, [manualSibling, plannedSibling]);

    expect(screen.queryByTestId("badge-strava-log-m1")).toBeNull();
    expect(screen.queryByTestId("strava-badge-menu-log-m1")).toBeNull();
    expect(screen.queryByTestId("device-link-suggestion-log-m1")).toBeNull();
  });
});
