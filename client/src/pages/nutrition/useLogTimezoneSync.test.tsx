import type { User } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { preferences } from "@/lib/api/user";
import { mockDeviceTimezone } from "@/test/support/deviceTimezone";

import { useLogTimezoneSync } from "./useLogTimezoneSync";
import { pageTimezone } from "./utils";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
const HONOLULU = "Pacific/Honolulu";

/** The zone the page dates by: utils built its formatter at import. */
function loadedZone(): string {
  const zone = pageTimezone();
  if (!zone) throw new Error("the page reports no timezone");
  return zone;
}

/** Move the OS timezone under the already-loaded page, as a flight does to a
 *  tab left open, and return where it went. Undo with `vi.unstubAllEnvs()`. */
function flyAwayFrom(loadedIn: string): string {
  const flownTo = loadedIn === AUCKLAND ? HONOLULU : AUCKLAND;
  vi.stubEnv("TZ", flownTo);
  return flownTo;
}

/** Render the hook against a cache holding a signed-in user whose profile is in `stored`. */
function renderSync(stored: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (stored) queryClient.setQueryData(QUERY_KEYS.authUser, { userTimezone: stored });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useLogTimezoneSync(), { wrapper }) };
}

// CL65 (CODEBASE_ANALYSIS_2026-10-03): the server dates an entry by the
// profile's timezone, so a stale one is corrected before the write.
describe("useLogTimezoneSync", () => {
  let update: MockInstance<typeof preferences.update>;

  beforeEach(() => {
    // Never reaches the network: each test that expects a save says how it ends.
    update = vi.spyOn(preferences, "update").mockRejectedValue(new Error("unexpected save"));
    toastMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes straight away when the profile and the device agree", () => {
    mockDeviceTimezone(LONDON);
    const write = vi.fn();
    const { result } = renderSync(LONDON);

    result.current.runSynced(write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes straight away when the profile's timezone is not known", () => {
    mockDeviceTimezone(NEW_YORK);
    const write = vi.fn();
    const { result } = renderSync(null);

    result.current.runSynced(write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves the device's timezone before the write when they differ", async () => {
    mockDeviceTimezone(NEW_YORK);
    update.mockResolvedValue({ userTimezone: NEW_YORK } as User);
    const write = vi.fn();
    const { result, queryClient } = renderSync(LONDON);

    act(() => {
      result.current.runSynced(write);
    });

    expect(write).not.toHaveBeenCalled();
    expect(result.current.isSyncing).toBe(true);
    expect(update).toHaveBeenCalledWith({ userTimezone: NEW_YORK });

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    expect(result.current.isSyncing).toBe(false);
    expect(queryClient.getQueryData<User>(QUERY_KEYS.authUser)?.userTimezone).toBe(NEW_YORK);
    expect(toastMock).not.toHaveBeenCalled();

    // The cached profile now agrees, so the next write needs no round trip.
    result.current.runSynced(write);
    expect(write).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("holds the write and offers to log anyway when the timezone cannot be saved", async () => {
    mockDeviceTimezone(NEW_YORK);
    update.mockRejectedValue(new Error("offline"));
    const write = vi.fn();
    const { result } = renderSync(LONDON);

    act(() => {
      result.current.runSynced(write);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
    expect(write).not.toHaveBeenCalled();
    expect(result.current.isSyncing).toBe(false);

    const shown = toastMock.mock.calls[0][0] as {
      title: string;
      description: string;
      action: ReactElement;
    };
    expect(shown.title).toBe("Couldn't update your timezone");
    expect(shown.description).toContain(LONDON);
    expect(shown.description).toContain(NEW_YORK);

    render(shown.action);
    await userEvent.setup().click(screen.getByTestId("button-log-anyway"));
    expect(write).toHaveBeenCalledTimes(1);
  });

  // A tab open across an OS timezone change keeps dating by the zone it
  // loaded with, so the profile must follow that zone, not a fresh lookup.
  it("leaves a profile that matches the page alone when the device's timezone moves on", () => {
    const loadedIn = loadedZone();
    const flownTo = flyAwayFrom(loadedIn);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(flownTo);
    expect(pageTimezone()).toBe(loadedIn);
    const write = vi.fn();
    const { result } = renderSync(loadedIn);

    result.current.runSynced(write);

    expect(write).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves the page's timezone, not the device's new one, over a stale profile", async () => {
    const loadedIn = loadedZone();
    const flownTo = flyAwayFrom(loadedIn);
    const stale = loadedIn === LONDON ? NEW_YORK : LONDON;
    update.mockResolvedValue({ userTimezone: loadedIn } as User);
    const write = vi.fn();
    const { result } = renderSync(stale);

    act(() => {
      result.current.runSynced(write);
    });

    expect(update).toHaveBeenCalledWith({ userTimezone: loadedIn });
    expect(update).not.toHaveBeenCalledWith({ userTimezone: flownTo });
    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
  });
});
