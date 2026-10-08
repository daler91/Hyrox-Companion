import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadLogWorkoutDraft, saveLogWorkoutDraft } from "@/hooks/useLogWorkoutDraft";
import { getTodayString } from "@/lib/dateUtils";

import { LogWorkoutForm } from "../LogWorkoutForm";
import type { LogWorkoutStepperLayout } from "../LogWorkoutStepperLayout";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), latest: vi.fn() }));

// The stepper is stubbed down to what this spec reads: the step the form
// resumed on and the date and title the save would use.
vi.mock("../LogWorkoutStepperLayout", () => ({
  LogWorkoutStepperLayout: (props: ComponentProps<typeof LogWorkoutStepperLayout>) => (
    <>
      <output data-testid="stepper">{`${props.step}|${props.date}|${props.title}`}</output>
      <button type="button" onClick={props.handleDuplicateLast}>
        Duplicate last
      </button>
    </>
  ),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, workouts: { ...actual.api.workouts, latest: mocks.latest } },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({
    weightUnit: "kg",
    distanceUnit: "km",
    weightLabel: "kg",
    distanceLabel: "km",
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/log", vi.fn()] }));

const ATHLETE = "athlete-1";
const MONDAY = "2020-01-06";

function seedDraft() {
  saveLogWorkoutDraft(ATHLETE, {
    title: "Leg day",
    date: MONDAY,
    freeText: "5x5 back squat",
    notes: "",
    rpe: null,
    timeOfDayMin: null,
    durationMinutes: "",
    distance: "",
    avgHeartrate: "",
    maxHeartrate: "",
    planId: null,
    planDayId: null,
    useTextMode: true,
    exerciseBlocks: [],
    exerciseData: {},
    structureBlocks: [],
    blockCounter: 0,
    step: 3,
  });
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LogWorkoutForm userKey={ATHLETE} />
    </QueryClientProvider>,
  );
}

const stepper = () => screen.getByTestId("stepper");

// CL44 (CODEBASE_ANALYSIS_2026-10-03): a restored draft resumed on its step,
// where the date is not shown, and could not be thrown away, so an abandoned
// Monday draft finished on Thursday was saved on Monday.
describe("LogWorkoutForm restoring a draft", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    globalThis.window.localStorage.clear();
    globalThis.window.sessionStorage.clear();
  });

  it("names the draft's date on the step it resumes and offers today's", () => {
    seedDraft();
    renderForm();

    expect(stepper()).toHaveTextContent(`3|${MONDAY}|Leg day`);
    const notice = screen.getByRole("region", { name: "Restored draft" });
    expect(notice).toHaveTextContent("dated Monday, Jan 6");
    expect(notice).toHaveTextContent("It will be saved on that date.");

    fireEvent.click(screen.getByRole("button", { name: "Use today's date" }));

    expect(stepper()).toHaveTextContent(`3|${getTodayString()}|Leg day`);
    expect(notice).not.toHaveTextContent("It will be saved on that date.");
    expect(screen.queryByRole("button", { name: "Use today's date" })).not.toBeInTheDocument();
  });

  it("discards the draft and starts a blank form on the first step", () => {
    seedDraft();
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

    expect(stepper()).toHaveTextContent(`1|${getTodayString()}|`);
    expect(screen.queryByRole("region", { name: "Restored draft" })).not.toBeInTheDocument();
    expect(loadLogWorkoutDraft(ATHLETE)).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Draft discarded" });
  });

  it("shows no notice for a fresh form", () => {
    renderForm();

    expect(stepper()).toHaveTextContent(`1|${getTodayString()}|`);
    expect(screen.queryByRole("region", { name: "Restored draft" })).not.toBeInTheDocument();
  });
});

// U30 (CODEBASE_ANALYSIS_2026-10-03): 'Duplicate last' replaced a restored
// draft with no check, and persistence then overwrote the saved draft.
describe("LogWorkoutForm duplicating the last workout", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.latest.mockReset();
    mocks.latest.mockResolvedValue({ focus: "Yesterday's intervals", notes: "", mainWorkout: "8x400m" });
    globalThis.window.localStorage.clear();
    globalThis.window.sessionStorage.clear();
  });

  it("asks before replacing entered work, and keeps it on cancel", async () => {
    seedDraft();
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate last" }));

    expect(await screen.findByRole("alertdialog", { name: "Replace this workout?" })).toBeInTheDocument();
    expect(mocks.latest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.latest).not.toHaveBeenCalled();
    expect(stepper()).toHaveTextContent(`3|${MONDAY}|Leg day`);
    expect(loadLogWorkoutDraft(ATHLETE)?.title).toBe("Leg day");
  });

  it("replaces the entry once the athlete confirms", async () => {
    seedDraft();
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate last" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));

    await waitFor(() => {
      expect(stepper()).toHaveTextContent("Yesterday's intervals");
    });
    expect(mocks.latest).toHaveBeenCalledTimes(1);
  });

  it("duplicates straight away on a blank form", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate last" }));

    await waitFor(() => {
      expect(stepper()).toHaveTextContent("Yesterday's intervals");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
