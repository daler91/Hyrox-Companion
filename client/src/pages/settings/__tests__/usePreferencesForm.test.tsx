import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferencesForm } from "../usePreferencesForm";

const harness = {
  toast: vi.fn(),
  updatePreferences: vi.fn<(payload: unknown) => Promise<unknown>>(),
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["preferences"],
    authUser: ["auth"],
  },
  api: {
    preferences: { update: (payload: unknown) => harness.updatePreferences(payload) },
  },
}));

function serverPreferences(overrides: Record<string, unknown> = {}) {
  return {
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: "prefer_not_to_say",
    weeklyGoal: 5,
    emailNotifications: false,
    emailWeeklySummary: false,
    emailMissedReminder: false,
    showAdherenceInsights: true,
    aiCoachEnabled: false,
    trainingStyleId: "balanced_default",
    mafAge: null,
    mafConsistency: null,
    mafTrend: null,
    mafHrDataAvailable: null,
    ...overrides,
  };
}

function renderForm(preferences = serverPreferences()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryDefaults(["preferences"], {
    queryFn: () => Promise.resolve(preferences),
    staleTime: Infinity,
  });
  qc.setQueryData(["preferences"], preferences);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePreferencesForm(), { wrapper });
}

describe("usePreferencesForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    harness.updatePreferences.mockResolvedValue({});
  });

  it("hydrates the draft from server preferences and starts clean", async () => {
    const { result } = renderForm(serverPreferences({ weeklyGoal: 6, weightUnit: "lbs" }));

    await waitFor(() => {
      expect(result.current.draft.weeklyGoal).toBe("6");
    });
    expect(result.current.draft.weightUnit).toBe("lbs");
    expect(result.current.hasChanges).toBe(false);
  });

  it("flips hasChanges on edit and back off when the edit is reverted", async () => {
    const { result } = renderForm();
    await waitFor(() => {
      expect(result.current.draft.weeklyGoal).toBe("5");
    });

    act(() => {
      result.current.updateField("weeklyGoal", "6");
    });
    expect(result.current.hasChanges).toBe(true);

    act(() => {
      result.current.updateField("weeklyGoal", "5");
    });
    expect(result.current.hasChanges).toBe(false);
  });

  it("treats numeric-input strings that normalize to the same value as clean", async () => {
    const { result } = renderForm(serverPreferences({ age: 30 }));
    await waitFor(() => {
      expect(result.current.draft.ageInput).toBe("30");
    });

    // Same canonical age, so the snapshot comparison stays clean.
    act(() => {
      result.current.updateField("ageInput", "30");
    });
    expect(result.current.hasChanges).toBe(false);

    act(() => {
      result.current.updateField("ageInput", "31");
    });
    expect(result.current.hasChanges).toBe(true);
  });

  it("saves the draft, resets the dirty flag, and promotes the new baseline", async () => {
    const { result } = renderForm();
    await waitFor(() => {
      expect(result.current.draft.weeklyGoal).toBe("5");
    });

    act(() => {
      result.current.updateField("weeklyGoal", "6");
    });
    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
    });
    expect(harness.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyGoal: 6 }),
    );
    await waitFor(() => {
      expect(result.current.hasChanges).toBe(false);
    });

    // Editing away from the *saved* value is dirty again; back to it is clean.
    act(() => {
      result.current.updateField("weeklyGoal", "5");
    });
    expect(result.current.hasChanges).toBe(true);
    act(() => {
      result.current.updateField("weeklyGoal", "6");
    });
    expect(result.current.hasChanges).toBe(false);
  });

  it("blocks saving MAF style without valid MAF inputs", async () => {
    const { result } = renderForm();
    await waitFor(() => {
      expect(result.current.draft.trainingStyleId).toBe("balanced_default");
    });

    act(() => {
      result.current.updateField("trainingStyleId", "maf_method");
    });
    act(() => {
      result.current.handleSave();
    });

    expect(harness.updatePreferences).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Complete MAF setup" }),
    );
    expect(result.current.hasRequiredMafInputs).toBe(false);
  });

  it("offers Undo after save that restores and persists the previous values", async () => {
    const { result } = renderForm();
    await waitFor(() => {
      expect(result.current.draft.weeklyGoal).toBe("5");
    });

    act(() => {
      result.current.updateField("weeklyGoal", "7");
    });
    act(() => {
      result.current.handleSave();
    });
    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
    });

    const toastCall = harness.toast.mock.calls.at(-1)?.[0] as {
      title: string;
      action?: { props: { onClick: () => void } };
    };
    expect(toastCall.title).toBe("Settings saved");
    expect(toastCall.action).toBeDefined();

    act(() => {
      toastCall.action!.props.onClick();
    });

    // Undo restores the pre-save draft and persists it.
    expect(result.current.draft.weeklyGoal).toBe("5");
    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(2);
    });
    expect(harness.updatePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ weeklyGoal: 5 }),
    );
  });
});
