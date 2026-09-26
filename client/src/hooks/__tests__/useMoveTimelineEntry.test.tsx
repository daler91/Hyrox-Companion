import type { TimelineEntry } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { addDays, format, subDays } from "date-fns";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/lib/queryClient";
import { flattenTimelineCache, type TimelineCache } from "@/lib/timelineCache";

import { useMoveTimelineEntry } from "../useMoveTimelineEntry";

const apiMocks = vi.hoisted(() => ({ updateDayWithoutPlan: vi.fn(), updateWorkout: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    plans: { updateDayWithoutPlan: apiMocks.updateDayWithoutPlan },
    workouts: { update: apiMocks.updateWorkout },
  },
  QUERY_KEYS: {
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    plans: ["/api/v1/plans"],
  },
}));
vi.mock("@/hooks/use-toast", async () => (await import("@/test/support/mutationHookMocks")).makeToastMock());

const TIMELINE_KEY = ["/api/v1/timeline", null];
const day = (offset: number) => format(addDays(new Date(), offset), "yyyy-MM-dd");

function seed(entry: TimelineEntry) {
  const cache: TimelineCache = { pages: [{ entries: [entry], nextCursor: null }], pageParams: [null] };
  queryClient.setQueryData(TIMELINE_KEY, cache);
}

function cachedEntry(): TimelineEntry | undefined {
  return flattenTimelineCache(queryClient.getQueryData<TimelineCache>(TIMELINE_KEY))[0];
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const missed = {
  id: "plan-pd-1",
  date: format(subDays(new Date(), 2), "yyyy-MM-dd"),
  type: "planned",
  status: "missed",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
  priority: "key",
  dayName: format(subDays(new Date(), 2), "EEEE"),
} as TimelineEntry;

beforeEach(() => {
  queryClient.clear();
  // Never resolves: the assertions are about the optimistic patch, before any refetch.
  apiMocks.updateDayWithoutPlan.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  queryClient.clear();
});

describe("useMoveTimelineEntry", () => {
  it("folds a missed session moved forward: planned again, remembering the day it was missed", async () => {
    seed(missed);
    const { result } = renderHook(() => useMoveTimelineEntry(null), { wrapper });

    act(() => {
      result.current.moveEntry(missed, day(1));
    });

    // onMutate awaits cancelQueries before it patches the cache.
    await waitFor(() => {
      expect(cachedEntry()).toMatchObject({
        date: day(1),
        status: "planned",
        recovery: "folded",
        missedOn: missed.date,
        // The weekday chip moves with the card.
        dayName: format(addDays(new Date(), 1), "EEEE"),
      });
    });
    expect(apiMocks.updateDayWithoutPlan).toHaveBeenCalledWith("pd-1", { scheduledDate: day(1) });
  });

  it("only moves a missed session to another past day", async () => {
    seed(missed);
    const { result } = renderHook(() => useMoveTimelineEntry(null), { wrapper });

    act(() => {
      result.current.moveEntry(missed, day(-1));
    });

    await waitFor(() => {
      expect(cachedEntry()).toMatchObject({ date: day(-1), status: "missed" });
    });
    expect(cachedEntry()?.recovery).toBeUndefined();
  });
});
