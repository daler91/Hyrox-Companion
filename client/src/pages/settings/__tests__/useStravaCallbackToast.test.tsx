import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStravaCallbackToast } from "../useStravaCallbackToast";

const mocks = vi.hoisted(() => ({
  search: "",
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", mocks.navigate],
  useSearch: () => mocks.search,
}));

describe("useStravaCallbackToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = "";
  });

  it("does nothing when there is no strava callback param", () => {
    mocks.search = "tab=integrations";
    const landOnIntegrations = vi.fn();

    renderHook(() => useStravaCallbackToast(landOnIntegrations));

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(landOnIntegrations).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized strava param value", () => {
    mocks.search = "strava=pending";
    const landOnIntegrations = vi.fn();

    renderHook(() => useStravaCallbackToast(landOnIntegrations));

    expect(mocks.toast).not.toHaveBeenCalled();
    expect(landOnIntegrations).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows a success toast, lands on Integrations, and strips the param on ?strava=connected", () => {
    mocks.search = "strava=connected";
    const landOnIntegrations = vi.fn();

    renderHook(() => useStravaCallbackToast(landOnIntegrations));

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Strava Connected" }),
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
    expect(landOnIntegrations).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/settings?tab=integrations", { replace: true });
  });

  it("shows a destructive toast, lands on Integrations, and strips the param on ?strava=error", () => {
    mocks.search = "strava=error";
    const landOnIntegrations = vi.fn();

    renderHook(() => useStravaCallbackToast(landOnIntegrations));

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Connection Failed", variant: "destructive" }),
    );
    expect(landOnIntegrations).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/settings?tab=integrations", { replace: true });
  });
});
