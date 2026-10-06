import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferencesForm } from "../usePreferencesForm";

const harness = {
  toast: vi.fn(),
  updatePreferences: vi.fn<(payload: unknown) => Promise<unknown>>(),
  invalidateQueries: vi.fn<(filters: unknown) => Promise<void>>(),
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: (filters: unknown) => harness.invalidateQueries(filters) },
}));
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["preferences"],
    authUser: ["auth"],
    // Every key the save reaches: one left out is an undefined key, which on
    // a real QueryClient invalidates every query.
    sessionGradesPrefix: ["/api/v1/session-grades"],
    workouts: ["/api/v1/workouts"],
    nutritionSessionFuellingPrefix: ["/api/v1/nutrition/session-fuelling"],
    nutritionDayPrefix: ["/api/v1/nutrition/summary"],
    nutritionRangePrefix: ["/api/v1/nutrition/summary-range"],
    nutritionBlockPrefix: ["/api/v1/nutrition/block"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
    trainingOverview: ["/api/v1/training-overview"],
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
    mafCategory: null,
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
  return { ...renderHook(() => usePreferencesForm(), { wrapper }), qc };
}

/** Render the form on default server preferences and wait for hydration. */
async function renderHydratedForm() {
  const { result, qc } = renderForm();
  await waitFor(() => {
    expect(result.current.draft.weeklyGoal).toBe("5");
  });
  return { result, qc };
}

describe("usePreferencesForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    harness.updatePreferences.mockResolvedValue({});
    harness.invalidateQueries.mockResolvedValue();
  });

  it("hydrates the draft from server preferences and starts clean", async () => {
    const { result } = renderForm(serverPreferences({ weeklyGoal: 6, weightUnit: "lbs" }));

    await waitFor(() => {
      expect(result.current.draft.weeklyGoal).toBe("6");
    });
    expect(result.current.draft.weightUnit).toBe("lbs");
    expect(result.current.hasChanges).toBe(false);
  });

  it("hydrates the notify hour and email digest toggles and sends them on save", async () => {
    const { result } = renderForm(
      serverPreferences({ notifyHour: 18, emailAnalysisDigest: true, emailTodaySession: true }),
    );

    await waitFor(() => {
      expect(result.current.draft.notifyHour).toBe(18);
    });
    expect(result.current.draft.emailAnalysisDigest).toBe(true);
    expect(result.current.hasChanges).toBe(false);

    act(() => {
      result.current.updateField("emailTodaySession", false);
    });
    expect(result.current.hasChanges).toBe(true);
    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
    });
    expect(harness.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ notifyHour: 18, emailAnalysisDigest: true, emailTodaySession: false }),
    );
  });

  it("hydrates per-email send hours and sends an override alongside a cleared one", async () => {
    const { result } = renderForm(
      serverPreferences({
        notifyHour: 7,
        notifyHourWeeklySummary: 9,
        notifyHourTodaySession: 19,
      }),
    );

    await waitFor(() => {
      expect(result.current.draft.notifyHourWeeklySummary).toBe(9);
    });
    expect(result.current.draft.notifyHourTodaySession).toBe(19);
    // Absent on the wire means "follow the default send time".
    expect(result.current.draft.notifyHourMissedReminder).toBeNull();
    expect(result.current.hasChanges).toBe(false);

    act(() => {
      result.current.updateField("notifyHourTodaySession", null);
    });
    act(() => {
      result.current.updateField("notifyHourMissedReminder", 21);
    });
    expect(result.current.hasChanges).toBe(true);
    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
    });
    expect(harness.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyHour: 7,
        notifyHourWeeklySummary: 9,
        notifyHourMissedReminder: 21,
        notifyHourTodaySession: null,
      }),
    );
  });

  it("flips hasChanges on edit and back off when the edit is reverted", async () => {
    const { result } = await renderHydratedForm();

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
    const { result } = await renderHydratedForm();

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

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): a session's fuelling targets and the
  // day's meal targets are sized to the bodyweight, and the training load
  // behind the chips and the Fuelling block reads it, the heart rates and the
  // units: each kept its old figures after a save.
  it("refreshes the fuelling reads when a new bodyweight is saved", async () => {
    const reads = new QueryClient();
    const session = ["/api/v1/nutrition/session-fuelling", "w1"];
    const day = ["/api/v1/nutrition/summary", "2026-09-15"];
    const range = ["/api/v1/nutrition/summary-range", "2026-09-09", "2026-09-15"];
    const block = ["/api/v1/nutrition/block", "2026-08-17", "2026-09-15"];
    const micros = ["/api/v1/nutrition/micros", "2026-09-15"];
    for (const key of [session, day, range, block, micros]) reads.setQueryData(key, {});
    harness.invalidateQueries.mockImplementation((filters) =>
      reads.invalidateQueries(filters as { queryKey: readonly unknown[] }),
    );
    const { result } = await renderHydratedForm();

    act(() => {
      result.current.updateField("bodyweightKg", 82);
    });
    act(() => {
      result.current.handleSave();
    });

    await waitFor(() => {
      for (const key of [session, day, range, block]) {
        expect(reads.getQueryState(key)?.isInvalidated).toBe(true);
      }
    });
    expect(reads.getQueryState(micros)?.isInvalidated).toBe(false);
    expect(harness.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ bodyweightKg: 82 }));
  });

  // CL67 (CODEBASE_ANALYSIS_2026-10-03): the server converts these into the
  // athlete's units, so a units change relabelled the cached numbers (a 100 kg
  // PR read "100 lbs") until their staleTime ran out.
  describe("the unit-converted analytics", () => {
    const records = ["/api/v1/personal-records", "2026-01-01", "2026-09-30"];
    const analytics = ["/api/v1/exercise-analytics", "2026-01-01", "2026-09-30"];
    const overview = ["/api/v1/training-overview", "2026-01-01", "2026-09-30"];
    const summary = ["/api/v1/training-overview", "summary"];

    async function saveEdit(field: "weightUnit" | "distanceUnit" | "weeklyGoal", value: string) {
      const reads = new QueryClient();
      for (const key of [records, analytics, overview, summary]) reads.setQueryData(key, {});
      harness.invalidateQueries.mockImplementation((filters) =>
        reads.invalidateQueries(filters as { queryKey: readonly unknown[] }),
      );
      const { result } = await renderHydratedForm();

      act(() => {
        result.current.updateField(field, value);
      });
      act(() => {
        result.current.handleSave();
      });
      await waitFor(() => {
        expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Settings saved" }));
      });
      return reads;
    }

    it.each([
      { field: "weightUnit", value: "lbs" },
      { field: "distanceUnit", value: "miles" },
    ] as const)("are refetched when the $field changes", async ({ field, value }) => {
      const reads = await saveEdit(field, value);

      for (const key of [records, analytics, overview, summary]) {
        expect(reads.getQueryState(key)?.isInvalidated).toBe(true);
      }
    });

    it("are left alone by a save that keeps the units", async () => {
      const reads = await saveEdit("weeklyGoal", "6");

      for (const key of [records, analytics, overview, summary]) {
        expect(reads.getQueryState(key)?.isInvalidated).toBe(false);
      }
    });
  });

  // CL68 (CODEBASE_ANALYSIS_2026-10-03): the save cleared the dirty flag, so
  // its own refetch overwrote an edit made while it was in flight and the Save
  // bar went away with it.
  it("keeps an edit made while the save was in flight, and keeps it dirty", async () => {
    const { result, qc } = await renderHydratedForm();
    const pendingSave = Promise.withResolvers<unknown>();
    harness.updatePreferences.mockReturnValueOnce(pendingSave.promise);

    act(() => {
      result.current.updateField("weeklyGoal", "6");
    });
    act(() => {
      result.current.handleSave();
    });
    act(() => {
      result.current.updateField("weightUnit", "lbs");
    });
    await act(async () => {
      pendingSave.resolve({});
      await pendingSave.promise;
    });
    await waitFor(() => {
      expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Settings saved" }));
    });
    // The refetch the save triggers delivers the row as saved.
    act(() => {
      qc.setQueryData(["preferences"], serverPreferences({ weeklyGoal: 6 }));
    });
    await waitFor(() => {
      expect(result.current.preferences?.weeklyGoal).toBe(6);
    });

    expect(result.current.draft.weightUnit).toBe("lbs");
    expect(result.current.draft.weeklyGoal).toBe("6");
    expect(result.current.hasChanges).toBe(true);
    // The saved goal is the new baseline: only the later edit is unsaved.
    act(() => {
      result.current.updateField("weightUnit", "kg");
    });
    expect(result.current.hasChanges).toBe(false);
  });

  it("keeps unsaved edits when a background refetch delivers changed preferences", async () => {
    const { result, qc } = await renderHydratedForm();

    act(() => {
      result.current.updateField("weeklyGoal", "6");
    });
    // Another tab saved a unit change; the query cache updates underneath the
    // half-edited form.
    act(() => {
      qc.setQueryData(["preferences"], serverPreferences({ weightUnit: "lbs" }));
    });
    await waitFor(() => {
      expect(result.current.preferences?.weightUnit).toBe("lbs");
    });

    expect(result.current.draft.weeklyGoal).toBe("6");
    expect(result.current.hasChanges).toBe(true);
  });

  it("re-syncs the draft and baseline from a refetch once the form is clean", async () => {
    const { result, qc } = await renderHydratedForm();

    act(() => {
      qc.setQueryData(["preferences"], serverPreferences({ weightUnit: "lbs" }));
    });

    await waitFor(() => {
      expect(result.current.draft.weightUnit).toBe("lbs");
    });
    // The server row is the committed state, so adopting it is not a change.
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

  // CL34 (CODEBASE_ANALYSIS_2026-10-03): accounts set up before audit M6 are on
  // MAF with no category (migration 0090 did not backfill one). Every save was
  // refused until they answered it, and answering rewrote their ceiling.
  describe("a MAF account set up before the category question", () => {
    const legacyMaf = serverPreferences({
      trainingStyleId: "maf_method",
      mafAge: 40,
      mafConsistency: "high",
      mafTrend: "improving",
      mafCategory: null,
      mafHr: 145,
    });

    async function renderLegacyMafForm() {
      const view = renderForm(legacyMaf);
      await waitFor(() => {
        expect(view.result.current.draft.mafAgeInput).toBe("40");
      });
      return view;
    }

    function savedPayload(): Record<string, unknown> {
      const [payload] = harness.updatePreferences.mock.calls.at(-1) ?? [];
      return payload as Record<string, unknown>;
    }

    it("saves other settings and leaves the stored ceiling alone", async () => {
      const { result } = await renderLegacyMafForm();

      act(() => {
        result.current.updateField("weightUnit", "lbs");
      });
      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
      });
      expect(harness.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Complete MAF setup" }));
      expect(savedPayload()).toMatchObject({ weightUnit: "lbs", trainingStyleId: "maf_method", mafCategory: null });
      // Absent on the wire: the server keeps the proxy-derived ceiling.
      expect(savedPayload().mafHr).toBeUndefined();
    });

    it("still asks for the category when the age that moves the ceiling changes", async () => {
      const { result } = await renderLegacyMafForm();

      act(() => {
        result.current.updateField("mafAgeInput", "41");
      });
      act(() => {
        result.current.handleSave();
      });

      expect(harness.updatePreferences).not.toHaveBeenCalled();
      expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Complete MAF setup" }));
    });

    it("recomputes the ceiling once the category is answered", async () => {
      const { result } = await renderLegacyMafForm();

      act(() => {
        result.current.updateField("mafCategoryInput", "training_interrupted");
      });
      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(harness.updatePreferences).toHaveBeenCalledTimes(1);
      });
      // 180 - 40, then -5 for this category.
      expect(savedPayload()).toMatchObject({ mafCategory: "training_interrupted", mafHr: 135 });
    });

    // The server accepts no category only beside the legacy consistency/trend
    // pair, and never without an age (validateMafTransition): those saves came
    // back 400 MAF_SETUP_REQUIRED, shown as "Failed to save settings".
    it.each([
      { name: "no legacy consistency/trend pair", overrides: { mafConsistency: null, mafTrend: null } },
      { name: "only half of that pair", overrides: { mafTrend: null } },
      { name: "no age", overrides: { mafAge: null } },
    ])("asks for MAF setup, before saving, on an account with $name", async ({ overrides }) => {
      const { result } = renderForm({ ...legacyMaf, ...overrides });
      await waitFor(() => {
        expect(result.current.draft.trainingStyleId).toBe("maf_method");
      });

      act(() => {
        result.current.updateField("weightUnit", "lbs");
      });
      act(() => {
        result.current.handleSave();
      });

      expect(harness.updatePreferences).not.toHaveBeenCalled();
      expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Complete MAF setup" }));
    });

    it("asks for MAF setup when the server refuses the save as incomplete", async () => {
      harness.updatePreferences.mockRejectedValueOnce(
        new Error(
          `400: ${JSON.stringify({ error: "MAF setup is incomplete", code: "MAF_SETUP_REQUIRED", details: [] })}`,
        ),
      );
      const { result } = await renderLegacyMafForm();

      act(() => {
        result.current.updateField("weightUnit", "lbs");
      });
      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Complete MAF setup" }));
      });
      expect(harness.toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ description: "Failed to save settings. Please try again." }),
      );
    });

    it("still says the save failed for any other refusal", async () => {
      harness.updatePreferences.mockRejectedValueOnce(new Error("500: Internal Server Error"));
      const { result } = await renderLegacyMafForm();

      act(() => {
        result.current.updateField("weightUnit", "lbs");
      });
      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(harness.toast).toHaveBeenCalledWith(
          expect.objectContaining({ description: "Failed to save settings. Please try again." }),
        );
      });
    });
  });

  it("reports a style change as saved even when its audit entry can't be stored", async () => {
    // The audit write runs inside the mutation's onSuccess; TanStack Query
    // routes a throw from there to onError, which told the athlete a save
    // the server had accepted had failed.
    const { result } = renderForm(serverPreferences({ trainingStyleId: "maf_method" }));
    await waitFor(() => {
      expect(result.current.draft.trainingStyleId).toBe("maf_method");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });

    try {
      act(() => {
        result.current.updateField("trainingStyleId", "balanced_default");
      });
      act(() => {
        result.current.handleSave();
      });

      await waitFor(() => {
        expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Settings saved" }));
      });
      expect(harness.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Error" }));
      expect(result.current.styleAuditEntries[0]).toMatchObject({
        fromStyleId: "maf_method",
        toStyleId: "balanced_default",
      });
    } finally {
      setItem.mockRestore();
    }
  });

  it("offers Undo after save that restores and persists the previous values", async () => {
    const { result } = await renderHydratedForm();

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
    // A save that left the MAF ceiling alone is undone without touching it.
    expect(harness.updatePreferences.mock.calls.at(-1)?.[0]).not.toHaveProperty("mafHr");
  });

  // CL69 (CODEBASE_ANALYSIS_2026-10-03): Undo restored the age and category
  // but not the ceiling computed from them, so grading kept the undone one.
  it("restores the MAF ceiling when it undoes a change to the age", async () => {
    const { result } = renderForm(
      serverPreferences({
        trainingStyleId: "maf_method",
        mafAge: 40,
        mafCategory: "consistent_up_to_2y",
        mafHr: 140,
      }),
    );
    await waitFor(() => {
      expect(result.current.draft.mafAgeInput).toBe("40");
    });

    act(() => {
      result.current.updateField("mafAgeInput", "50");
    });
    act(() => {
      result.current.handleSave();
    });
    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ mafAge: 50, mafHr: 130 }),
      );
    });
    const toastCall = harness.toast.mock.calls.at(-1)?.[0] as {
      action?: { props: { onClick: () => void } };
    };

    act(() => {
      toastCall.action!.props.onClick();
    });

    await waitFor(() => {
      expect(harness.updatePreferences).toHaveBeenCalledTimes(2);
    });
    expect(harness.updatePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ mafAge: 40, mafHr: 140 }),
    );
    expect(result.current.draft.mafAgeInput).toBe("40");
  });
});
