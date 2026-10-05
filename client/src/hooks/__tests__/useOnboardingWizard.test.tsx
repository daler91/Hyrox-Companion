import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { api } from "@/lib/api";

const mockToast = vi.fn();
const invalidateQueries = vi.hoisted(() =>
  vi.fn<(filters: { queryKey: readonly unknown[] }) => Promise<void>>().mockResolvedValue(),
);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries } }));
// Every key the hook reaches, NUTRITION_TARGET_QUERY_KEYS's and
// WORKOUT_DERIVED_NUTRITION_QUERY_KEYS's included: one left out is an undefined
// key, which on a real QueryClient invalidates every query.
vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["preferences"],
    authUser: ["authUser"],
    plans: ["plans"],
    timeline: ["timeline"],
    nutritionTargets: ["nutritionTargets"],
    nutritionSessionFuellingPrefix: ["nutritionSessionFuelling"],
    nutritionDayPrefix: ["nutritionDay"],
    nutritionRangePrefix: ["nutritionRange"],
    nutritionBlockPrefix: ["nutritionBlock"],
  },
  api: {
    preferences: { update: vi.fn().mockResolvedValue({}) },
    plans: { createSample: vi.fn(), schedule: vi.fn(), deletePlan: vi.fn().mockResolvedValue({}) },
    nutrition: {
      getTargets: vi.fn().mockResolvedValue({ current: null, history: [] }),
      setTarget: vi.fn().mockResolvedValue({}),
    },
  },
}));

const samplePlan = {
  id: "sample-plan",
  userId: "user-1",
  name: "Sample Plan",
  sourceFileName: null,
  totalWeeks: 8,
  goal: null,
  startDate: null,
  endDate: null,
  raceDate: null,
  generationStatus: "ready",
  generationError: null,
  retiredOn: null,
  generationStartedAt: null,
  engineState: null,
};

function mockSamplePlanCreation() {
  vi.mocked(api.plans.createSample).mockResolvedValueOnce(samplePlan);
}

function renderOnboardingWizard(onComplete = vi.fn()) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    ...renderHook(({ open }: { open: boolean }) => useOnboardingWizard(onComplete, open), {
      wrapper,
      initialProps: { open: true },
    }),
    onComplete,
  };
}

type WizardHook = ReturnType<typeof renderOnboardingWizard>["result"];

/** Presses Continue once and lets the step's save settle. */
async function pressContinue(result: WizardHook) {
  await act(async () => {
    await result.current.handleNext();
  });
}

// Picks the template and presses Start Training, whose schedule request fails
// the first time.
function startTemplateWithFailingSchedule() {
  mockSamplePlanCreation();
  vi.mocked(api.plans.schedule).mockRejectedValueOnce(new Error("500: boom"));
  const { result, onComplete } = renderOnboardingWizard();
  act(() => {
    result.current.handleUseSamplePlan();
  });
  act(() => {
    result.current.handleStartTraining();
  });
  return { result, onComplete };
}

describe("useOnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A test that routes it to a real QueryClient must not leak that client.
    invalidateQueries.mockResolvedValue();
    localStorage.clear();
  });

  it("captures onboarding style and MAF payload when selecting maf_method", async () => {
    const { result } = renderOnboardingWizard();

    await pressContinue(result); // welcome -> units
    await pressContinue(result); // units -> goal

    act(() => {
      result.current.setTrainingStyleId("maf_method");
      result.current.setMafAge("40");
      result.current.setMafCategory("consistent_2y_plus_improving");
      result.current.setMafHrDataAvailable(true);
    });

    await pressContinue(result); // goal -> plan

    expect(api.preferences.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trainingStyleId: "maf_method",
        mafAge: 40,
        mafCategory: "consistent_2y_plus_improving",
        mafHrDataAvailable: true,
        mafHr: 145,
      }),
    );
  });

  // Creating the template plan on the Plan step left an unscheduled copy
  // behind every time the athlete went Back and chose again (audit H3).
  it("creates the template plan only on Start Training, once, however often the athlete goes back", async () => {
    // api.plans.schedule is a bare mock, so scheduling succeeds unless a test
    // says otherwise.
    mockSamplePlanCreation();
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });
    expect(result.current.step).toBe("schedule");
    act(() => {
      result.current.handleBack();
    });
    act(() => {
      result.current.handleUseSamplePlan();
    });
    expect(api.plans.createSample).not.toHaveBeenCalled();

    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("sample"));
    expect(api.plans.createSample).toHaveBeenCalledTimes(1);
    expect(api.plans.schedule).toHaveBeenCalledWith("sample-plan", expect.any(String));
  });

  it("reuses the created plan when a failed schedule is retried", async () => {
    const { onComplete, result } = startTemplateWithFailingSchedule();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Failed to set up your plan", variant: "destructive" }),
      ),
    );

    act(() => {
      result.current.handleStartTraining();
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("sample"));
    expect(api.plans.createSample).toHaveBeenCalledTimes(1);
    expect(api.plans.schedule).toHaveBeenCalledTimes(2);
    expect(api.plans.deletePlan).not.toHaveBeenCalled();
  });

  it("discards a template plan whose schedule failed when the athlete leaves another way", async () => {
    const { onComplete, result } = startTemplateWithFailingSchedule();
    await waitFor(() => expect(api.plans.schedule).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isSchedulePending).toBe(false));

    act(() => {
      result.current.handleSkip();
    });

    expect(api.plans.deletePlan).toHaveBeenCalledWith("sample-plan");
    expect(onComplete).toHaveBeenCalledWith("skip");
  });

  // One Esc used to end onboarding for good with no word on how to come back
  // (audit H4); the wizard now confirms first, and leaving says where to go.
  it("says where to run setup again when the athlete leaves", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleLeaveSetup();
    });

    expect(onComplete).toHaveBeenCalledWith("skip");
    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(mockToast).toHaveBeenCalledWith({
      title: "Setup closed",
      description: "Run it again anytime from Settings → Account → Getting Started.",
    });
  });

  it("marks durable completion when skipping onboarding", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleSkip();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(onComplete).toHaveBeenCalledWith("skip");
  });

  it("marks durable completion when an AI plan is generated", () => {
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleGeneratedPlan();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(onComplete).toHaveBeenCalledWith("generated");
  });

  it("marks durable completion after scheduling a sample plan", async () => {
    mockSamplePlanCreation();
    vi.mocked(api.plans.schedule).mockResolvedValueOnce(undefined);
    const { onComplete, result } = renderOnboardingWizard();

    act(() => {
      result.current.handleUseSamplePlan();
    });

    expect(result.current.step).toBe("schedule");

    act(() => {
      result.current.handleStartTraining();
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("sample");
    });
    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    // Points at connecting a device, which setup never mentioned (audit L7).
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Your training plan is ready!" }),
    );
    expect(mockToast.mock.lastCall?.[0]).toHaveProperty("action");
  });

  it("shows an error toast if prefsMutation fails on 'units' step, but still advances to 'goal' step", async () => {
    vi.mocked(api.preferences.update).mockRejectedValueOnce(new Error("Failed to update"));
    const { result } = renderOnboardingWizard();

    await pressContinue(result); // welcome -> units

    expect(result.current.step).toBe("units");

    // Only changed answers are written (onboarding audit H2), so change one.
    act(() => {
      result.current.setWeightUnit("lbs");
    });
    await pressContinue(result); // units -> goal (attempt)

    expect(mockToast).toHaveBeenCalledWith({
      title: "Could not save preferences",
      description: "You can update them later in settings.",
      variant: "destructive",
    });
    // Even if it fails, the current logic advances to "goal" step
    expect(result.current.step).toBe("goal");
  });

  it("shows an error toast and does not advance to 'plan' if prefsMutation fails on 'goal' step", async () => {
    const { result } = renderOnboardingWizard();

    await pressContinue(result); // welcome -> units
    await pressContinue(result); // units -> goal

    act(() => {
      result.current.setTrainingStyleId("maf_method");
      result.current.setMafAge("40");
      result.current.setMafCategory("consistent_up_to_2y");
    });
    vi.mocked(api.preferences.update).mockRejectedValueOnce(new Error("Failed to update"));

    await pressContinue(result); // goal -> next step (attempt)

    expect(mockToast).toHaveBeenCalledWith({
      title: "Could not save training style",
      description: "Please try again. You can also update this later in settings.",
      variant: "destructive",
    });
    // the code does NOT move on if the mutation fails
    expect(result.current.step).toBe("goal");
  });

  it("writes nothing when a step is left as saved", async () => {
    const { result } = renderOnboardingWizard();

    await pressContinue(result); // welcome -> units
    await pressContinue(result); // units -> goal
    await pressContinue(result); // goal -> next step

    expect(api.preferences.update).not.toHaveBeenCalled();
    expect(result.current.step).not.toBe("goal");
  });

  // Age used to be saved only through the optional fuelling step (audit M3).
  it("saves a general age from the Units step as a number", async () => {
    const { result } = renderOnboardingWizard();
    await pressContinue(result); // welcome -> units
    act(() => {
      result.current.setAge("41");
    });
    await pressContinue(result);

    expect(api.preferences.update).toHaveBeenCalledWith({ age: 41 });
    expect(result.current.step).toBe("goal");
  });

  it("keeps the athlete on the Units step with a named error for an impossible age", async () => {
    const { result } = renderOnboardingWizard();
    await pressContinue(result);
    act(() => {
      result.current.setAge("7");
    });
    await pressContinue(result);

    expect(result.current.step).toBe("units");
    expect(result.current.ageError).toMatch(/between 13 and 100/);
    expect(api.preferences.update).not.toHaveBeenCalled();

    act(() => {
      result.current.setAge("");
    });
    expect(result.current.ageError).toBeNull();
  });

  // Validation named no field and only toasted (audit M4).
  it("names each missing MAF answer inline instead of toasting", async () => {
    const { result } = renderOnboardingWizard();
    await pressContinue(result);
    await pressContinue(result); // units -> goal
    act(() => {
      result.current.setTrainingStyleId("maf_method");
    });
    await pressContinue(result);

    expect(result.current.step).toBe("goal");
    expect(result.current.mafErrors.age).toBeTruthy();
    expect(result.current.mafErrors.category).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalled();

    act(() => {
      result.current.setMafCategory("consistent_up_to_2y");
    });
    expect(result.current.mafErrors.category).toBeUndefined();
    expect(result.current.mafErrors.age).toBeTruthy();
  });

  // CL9 (CODEBASE_ANALYSIS_2026-10-03): a typed past race date (a mistyped
  // year) made every day of a template plan post-race recovery.
  describe("a race date the Goal step can't use", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 4, 12));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderOnGoalStep() {
      const view = renderOnboardingWizard();
      await pressContinue(view.result); // welcome -> units
      await pressContinue(view.result); // units -> goal
      return view;
    }

    function typeRaceDate(result: WizardHook, value: string) {
      act(() => {
        result.current.setRaceDate(value);
      });
    }

    it("holds the Goal step until it is corrected", async () => {
      const { result } = await renderOnGoalStep();
      typeRaceDate(result, "2025-11-15");

      await pressContinue(result);
      expect(result.current.step).toBe("goal");
      expect(result.current.raceDate).toBe("2025-11-15");

      typeRaceDate(result, "2026-11-15");
      await pressContinue(result);
      expect(result.current.step).not.toBe("goal");
      expect(result.current.goalDescription).toMatch(/racing on 2026-11-15/);
    });

    it("lets the athlete move on once it is cleared", async () => {
      const { result } = await renderOnGoalStep();
      typeRaceDate(result, "2025-11-15");
      typeRaceDate(result, "");

      await pressContinue(result);
      expect(result.current.step).not.toBe("goal");
    });

    it("still names the missing MAF answers, and saves nothing, while it holds", async () => {
      const { result } = await renderOnGoalStep();
      act(() => {
        result.current.setRaceDate("2025-11-15");
        result.current.setTrainingStyleId("maf_method");
      });

      await pressContinue(result);
      expect(result.current.step).toBe("goal");
      expect(result.current.mafErrors.category).toBeTruthy();
      expect(api.preferences.update).not.toHaveBeenCalled();
    });

    // A race typed for today just before midnight is past once Continue is
    // pressed after it, and the step names it so.
    it("checks it against today as it is when Continue is pressed", async () => {
      const { result } = await renderOnGoalStep();
      expect(result.current.minRaceDate).toBe("2026-10-04");
      typeRaceDate(result, "2026-10-04");

      vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
      await pressContinue(result);

      expect(result.current.step).toBe("goal");
      // The step is told the new today, so it names the date as past.
      expect(result.current.minRaceDate).toBe("2026-10-05");
    });

    // A browser date field takes a five-digit year, which sorts after today;
    // the server then refused it at Start Training with a generic toast.
    it("holds a date that is not a real day", async () => {
      const { result } = await renderOnGoalStep();
      typeRaceDate(result, "20266-11-15");

      await pressContinue(result);
      expect(result.current.step).toBe("goal");
    });

    it("moves focus to the race-date field when it holds the step", async () => {
      const { result } = await renderOnGoalStep();
      const input = document.createElement("input");
      document.body.append(input);
      result.current.raceDateInputRef.current = input;
      typeRaceDate(result, "2025-11-15");

      await pressContinue(result);

      expect(document.activeElement).toBe(input);
      input.remove();
    });
  });

  // CL9 (CODEBASE_ANALYSIS_2026-10-03): the wizard stays mounted while hidden,
  // so a today read once on mount went stale overnight, and the picker's `min`
  // and the step's error used yesterday until the first Continue.
  describe("the earliest race date offered", () => {
    const AFTER_MIDNIGHT = new Date(2026, 9, 5, 0, 1);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 4, 23, 59));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("is today as of reaching the Goal step", async () => {
      const { result } = renderOnboardingWizard();
      await pressContinue(result); // welcome -> units

      vi.setSystemTime(AFTER_MIDNIGHT);
      await pressContinue(result); // units -> goal

      expect(result.current.step).toBe("goal");
      expect(result.current.minRaceDate).toBe("2026-10-05");
    });

    it("is today again on coming Back to the Goal step", async () => {
      const { result } = renderOnboardingWizard();
      await pressContinue(result); // welcome -> units
      await pressContinue(result); // units -> goal
      await pressContinue(result); // goal -> the next step
      expect(result.current.step).not.toBe("goal");

      vi.setSystemTime(AFTER_MIDNIGHT);
      act(() => {
        result.current.handleBack();
      });

      expect(result.current.step).toBe("goal");
      expect(result.current.minRaceDate).toBe("2026-10-05");
    });

    it("is today again when the wizard reopens on the Goal step", async () => {
      const { result, rerender } = renderOnboardingWizard();
      await pressContinue(result); // welcome -> units
      await pressContinue(result); // units -> goal
      expect(result.current.minRaceDate).toBe("2026-10-04");
      rerender({ open: false });

      vi.setSystemTime(AFTER_MIDNIGHT);
      rerender({ open: true });

      expect(result.current.step).toBe("goal");
      expect(result.current.minRaceDate).toBe("2026-10-05");
    });
  });

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): the units step's sex, age and units
  // feed the training load and energy balance, which session fuelling, the day
  // summary, the chips and the Fuelling block read; the save left them stale.
  it("refreshes the fuelling reads built from the profile when the units step saves", async () => {
    const reads = new QueryClient();
    const session = ["nutritionSessionFuelling", "w1"];
    const day = ["nutritionDay", "2026-09-15"];
    const range = ["nutritionRange", "2026-09-09", "2026-09-15"];
    const block = ["nutritionBlock", "2026-08-17", "2026-09-15"];
    for (const key of [session, day, range, block, ["nutritionTargets"]])
      reads.setQueryData(key, {});
    invalidateQueries.mockImplementation((filters) => reads.invalidateQueries(filters));
    const { result } = renderOnboardingWizard();
    await pressContinue(result); // welcome -> units
    act(() => {
      result.current.setAge("41");
    });

    await pressContinue(result); // units -> goal

    expect(api.preferences.update).toHaveBeenCalledWith({ age: 41 });
    for (const key of [session, day, range, block]) {
      expect(reads.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(reads.getQueryState(["nutritionTargets"])?.isInvalidated).toBe(false);
  });

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): the profile save refreshes the reads
  // built from it, and the target save every read that carries the target.
  it("invalidates exactly the profile and target reads when the fuelling step sets targets", async () => {
    const { result } = renderOnboardingWizard();
    await pressContinue(result); // welcome -> units
    await pressContinue(result); // units -> goal
    await pressContinue(result); // goal -> fuelling
    expect(result.current.step).toBe("fuelling");
    act(() => {
      result.current.setBodyweight("80");
      result.current.setHeightCm("180");
      result.current.setAge("35");
      result.current.setActivityLevel("moderate");
    });
    invalidateQueries.mockClear();

    await pressContinue(result); // fuelling -> coach

    expect(api.nutrition.setTarget).toHaveBeenCalledTimes(1);
    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["preferences"] },
      { queryKey: ["authUser"] },
      { queryKey: ["nutritionSessionFuelling"] },
      { queryKey: ["nutritionDay"] },
      { queryKey: ["nutritionRange"] },
      { queryKey: ["nutritionBlock"] },
      { queryKey: ["nutritionTargets"] },
      { queryKey: ["nutritionDay"] },
      { queryKey: ["nutritionRange"] },
      { queryKey: ["nutritionBlock"] },
    ]);
  });

  it("starts the MAF age from the age already given", () => {
    const { result } = renderOnboardingWizard();
    act(() => {
      result.current.setAge("38");
    });
    act(() => {
      result.current.setTrainingStyleId("maf_method");
    });
    expect(result.current.mafAge).toBe("38");
  });

  it("carries a lose-weight goal into the fuelling step's weight goal", () => {
    const { result } = renderOnboardingWizard();
    expect(result.current.weightGoalDirection).toBe("maintain");
    act(() => {
      result.current.setSelectedGoal("weight_loss");
    });
    expect(result.current.weightGoalDirection).toBe("lose");
    act(() => {
      result.current.setWeightGoalDirection("gain");
    });
    expect(result.current.weightGoalDirection).toBe("gain");
  });
});
