import type { WeeklyReview } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";

import { useWeeklyReview } from "../useWeeklyReview";

const mocks = vi.hoisted(() => ({ getWeeklyReview: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: { ...actual.api.analytics, getWeeklyReview: mocks.getWeeklyReview },
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
