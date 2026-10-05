import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { type ComponentProps, createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoalStep, raceDateError } from "../GoalStep";

const onRaceDateChange = vi.fn();

/** The step as the wizard holds it: the typed race date lives outside it. */
function ControlledGoalStep(props: Readonly<ComponentProps<typeof GoalStep>>) {
  const [raceDate, setRaceDate] = useState(props.raceDate ?? "");
  return (
    <GoalStep
      {...props}
      raceDate={raceDate}
      onRaceDateChange={(value) => {
        setRaceDate(value);
        props.onRaceDateChange?.(value);
      }}
    />
  );
}

function renderGoalStep(overrides: Partial<ComponentProps<typeof GoalStep>> = {}) {
  const props: ComponentProps<typeof GoalStep> = {
    selectedGoal: "functional",
    onGoalChange: vi.fn(),
    trainingStyleId: "balanced_default",
    onTrainingStyleChange: vi.fn(),
    mafAge: "",
    onMafAgeChange: vi.fn(),
    mafCategory: "",
    onMafCategoryChange: vi.fn(),
    mafHrDataAvailable: false,
    onMafHrDataAvailableChange: vi.fn(),
    raceDate: "",
    onRaceDateChange,
    minRaceDate: "2026-10-04",
    ...overrides,
  };
  return render(<ControlledGoalStep {...props} />);
}

/** Type a whole date into the field, as a keyboard user does past the picker. */
function typeRaceDate(value: string) {
  fireEvent.change(screen.getByLabelText(/Race date/), { target: { value } });
}

// CL9 (CODEBASE_ANALYSIS_2026-10-03): what the step names, and what the
// wizard checks again on Continue to hold the step.
describe("raceDateError", () => {
  it.each(["", "2026-10-04", "2026-11-15", "2028-02-29"])("takes %j", (raceDate) => {
    expect(raceDateError(raceDate, "2026-10-04")).toBeNull();
  });

  it.each(["2026-10-03", "2025-11-15"])("names %s as past", (raceDate) => {
    expect(raceDateError(raceDate, "2026-10-04")).toMatch(/That date has passed/);
  });

  // A five-digit year sorts after any four-digit today, and an impossible day
  // rolls forward into a real one: both read as a race still ahead.
  it.each(["20266-11-15", "2026-13-45", "2026-02-30", "2027-02-29", "2026-1-5", "15/11/2026"])(
    "names %s as not a real date",
    (raceDate) => {
      expect(raceDateError(raceDate, "2026-10-04")).toMatch(/That isn't a real date/);
    },
  );
});

// CL9 (CODEBASE_ANALYSIS_2026-10-03): the native `min` only limits the picker,
// so a typed past date (a mistyped year) reached the template plan and made
// every day of it post-race recovery. The step names it, and the wizard holds
// the step until it is fixed.
describe("GoalStep race date", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("hands on a race still ahead, without an error", () => {
    renderGoalStep();

    typeRaceDate("2026-11-15");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("2026-11-15");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a race today", () => {
    renderGoalStep();

    typeRaceDate("2026-10-04");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("2026-10-04");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a typed past date", async () => {
    const { container } = renderGoalStep();

    typeRaceDate("2025-11-15");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("2025-11-15");
    const input = screen.getByLabelText(/Race date/);
    expect(input).toHaveValue("2025-11-15");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("That date has passed"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("clears the error once the date is corrected", () => {
    renderGoalStep();

    typeRaceDate("2025-11-15");
    typeRaceDate("2026-11-15");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("2026-11-15");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Race date/)).not.toHaveAttribute("aria-invalid");
  });

  it("measures against today when no earliest date is given", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12));
    renderGoalStep({ minRaceDate: undefined });

    typeRaceDate("2026-10-03");

    expect(screen.getByRole("alert")).toHaveTextContent("That date has passed");
  });

  it("takes a cleared date: the race is optional", () => {
    renderGoalStep();

    typeRaceDate("2025-11-15");
    typeRaceDate("");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // The wizard keeps what was typed, so going Back and returning to the step
  // still names the date that holds it.
  it("names a past date it is given back", () => {
    renderGoalStep({ raceDate: "2025-11-15" });

    expect(screen.getByRole("alert")).toHaveTextContent("That date has passed");
    expect(screen.getByLabelText(/Race date/)).toHaveValue("2025-11-15");
  });

  // Chrome's date field takes a five-digit year. It sorted after today, so the
  // step took it and the server refused it at Start Training with a generic
  // toast.
  it("names a five-digit year as not a real date", () => {
    renderGoalStep();

    typeRaceDate("20266-11-15");

    expect(onRaceDateChange).toHaveBeenLastCalledWith("20266-11-15");
    const input = screen.getByLabelText(/Race date/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("That isn't a real date"));
  });

  // The wizard focuses the field when the date holds the step.
  it("hands the wizard its input", () => {
    const raceDateInputRef = createRef<HTMLInputElement>();
    renderGoalStep({ raceDateInputRef });

    expect(raceDateInputRef.current).toBe(screen.getByLabelText(/Race date/));
  });
});
