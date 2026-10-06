import type { WeeklyReview } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient as appQueryClient } from "@/lib/queryClient";

import { useSetWeeklyReviewIntent, useWeeklyReview } from "../useWeeklyReview";

const mocks = vi.hoisted(() => ({ getWeeklyReview: vi.fn(), setWeeklyReviewIntent: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: {
        ...actual.api.analytics,
        getWeeklyReview: mocks.getWeeklyReview,
        setWeeklyReviewIntent: mocks.setWeeklyReviewIntent,
      },
    },
  };
});

// Long closed: no "is this the running week" branch applies.
const CLOSED_WEEK = "2025-01-06";

function review(): WeeklyReview {
  return { weekStart: CLOSED_WEEK, sessions: [], plannedDays: [] } as unknown as WeeklyReview;
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const mount = async () => {
    const hook = renderHook(() => useWeeklyReview(CLOSED_WEEK), { wrapper });
    // Both read in one callback, so the observer tracks isFetching from the
    // first check and re-renders when a refetch started on mount settles.
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
      expect(hook.result.current.isFetching).toBe(false);
    });
    return hook;
  };
  return { client, mount };
}

/** A loaded timeline page in the cache, as the Timeline page leaves it. */
function seedTimeline(client: QueryClient) {
  client.setQueryData([...QUERY_KEYS.timeline, null], { pages: [], pageParams: [] });
}

describe("useWeeklyReview closed-week caching (CL22)", () => {
  beforeEach(() => {
    mocks.getWeeklyReview.mockReset();
    mocks.getWeeklyReview.mockImplementation(() => Promise.resolve(review()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a closed week from cache while the timeline has not changed", async () => {
    const { client, mount } = setup();
    seedTimeline(client);

    (await mount()).unmount();
    await mount();

    expect(mocks.getWeeklyReview).toHaveBeenCalledTimes(1);
  });

  it("refetches a closed week after a timeline write invalidated the timeline", async () => {
    const { client, mount } = setup();
    seedTimeline(client);
    (await mount()).unmount();

    // What every timeline write (late log, complete, skip, move, delete,
    // annotation) does on success.
    await client.invalidateQueries({ queryKey: QUERY_KEYS.timeline });
    await mount();

    expect(mocks.getWeeklyReview).toHaveBeenCalledTimes(2);
  });

  it("refetches a closed week once the timeline has been refetched since", async () => {
    const { client, mount } = setup();
    seedTimeline(client);
    (await mount()).unmount();

    await new Promise((resolve) => setTimeout(resolve, 5));
    seedTimeline(client);
    await mount();

    expect(mocks.getWeeklyReview).toHaveBeenCalledTimes(2);
  });

  it("does not hold a closed week forever when no timeline cache can vouch for it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    const { mount } = setup();
    (await mount()).unmount();

    vi.setSystemTime(new Date("2026-10-04T12:05:00Z"));
    await mount();

    expect(mocks.getWeeklyReview).toHaveBeenCalledTimes(2);
  });
});

// CL51 (CODEBASE_ANALYSIS_2026-10-03): a mid-week `?week=` link and the intent
// save must land on one cache key, or the save never refreshes the open page.
describe("useWeeklyReview week key (CL51)", () => {
  // Wednesdays of two consecutive closed weeks (Mondays 2025-01-06 and -13).
  const MID_WEEK = "2025-01-08";
  const NEXT_MID_WEEK = "2025-01-15";

  beforeEach(() => {
    mocks.getWeeklyReview.mockReset();
    mocks.getWeeklyReview.mockImplementation(() => Promise.resolve(review()));
    mocks.setWeeklyReviewIntent.mockReset();
    mocks.setWeeklyReviewIntent.mockResolvedValue({ weekStart: CLOSED_WEEK, intent: "Hold the pace" });
  });

  afterEach(() => {
    appQueryClient.clear();
  });

  it("asks for and caches a mid-week date under its Monday", async () => {
    const { client } = setup();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const hook = renderHook(() => useWeeklyReview(MID_WEEK), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });

    expect(mocks.getWeeklyReview).toHaveBeenCalledWith(CLOSED_WEEK);
    expect(client.getQueryData(QUERY_KEYS.weeklyReview(CLOSED_WEEK))).toBeDefined();
    expect(client.getQueryData(QUERY_KEYS.weeklyReview(MID_WEEK))).toBeUndefined();
  });

  it("refetches the open mid-week review and next week's after an intent save", async () => {
    // useApiMutation invalidates through the app's client, so both render under it.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () => ({
        thisWeek: useWeeklyReview(MID_WEEK),
        nextWeek: useWeeklyReview(NEXT_MID_WEEK),
        save: useSetWeeklyReviewIntent(CLOSED_WEEK),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(hook.result.current.thisWeek.isSuccess).toBe(true);
      expect(hook.result.current.nextWeek.isSuccess).toBe(true);
    });
    mocks.getWeeklyReview.mockClear();

    await act(async () => {
      await hook.result.current.save.mutateAsync("Hold the pace");
    });

    await waitFor(() => {
      expect(mocks.getWeeklyReview).toHaveBeenCalledWith(CLOSED_WEEK);
      expect(mocks.getWeeklyReview).toHaveBeenCalledWith("2025-01-13");
    });
  });
});
