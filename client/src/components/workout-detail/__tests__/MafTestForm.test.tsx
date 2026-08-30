import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MafTestForm } from "../MafTestForm";

// Mutable so each test can pick the athlete's distance unit before rendering.
const { unit } = vi.hoisted(() => {
  const unit: { value: "km" | "miles" } = { value: "km" };
  return { unit };
});

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ distanceUnit: unit.value, distanceLabel: unit.value }),
}));

const noop = () => {};
const emptyInitial = { avgHeartRate: null, maxHeartRate: null, durationSeconds: null, distanceMeters: null };

/** Render an empty create-mode form and hand back its onSubmit spy. */
function renderCreateForm() {
  const onSubmit = vi.fn();
  render(
    <MafTestForm open onOpenChange={noop} mode="create" initial={emptyInitial} isPending={false} onSubmit={onSubmit} />,
  );
  return onSubmit;
}

/** Type `value` into `testId`, submit, and expect a blocked, errored form. */
async function submitAndExpectBlocked(onSubmit: ReturnType<typeof vi.fn>, testId: string, value: string) {
  await userEvent.type(screen.getByTestId(testId), value);
  await userEvent.click(screen.getByTestId("maf-test-form-submit"));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId("maf-test-form-error")).toBeInTheDocument();
}

describe("MafTestForm", () => {
  beforeEach(() => {
    unit.value = "km";
  });

  it("prefills canonical metrics in display units and submits them back as canonical", async () => {
    const onSubmit = vi.fn();
    render(
      <MafTestForm
        open
        onOpenChange={noop}
        mode="edit"
        initial={{ avgHeartRate: 150, maxHeartRate: 162, durationSeconds: 1710, distanceMeters: 5000 }}
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId("maf-test-form-avg-hr")).toHaveValue("150");
    expect(screen.getByTestId("maf-test-form-max-hr")).toHaveValue("162");
    expect(screen.getByTestId("maf-test-form-duration")).toHaveValue("28:30");
    expect(screen.getByTestId("maf-test-form-distance")).toHaveValue("5"); // 5000 m → 5 km

    await userEvent.click(screen.getByTestId("maf-test-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      avgHeartRate: 150,
      maxHeartRate: 162,
      durationSeconds: 1710,
      distanceMeters: 5000,
    });
  });

  it("converts a distance entered in miles back to canonical meters", async () => {
    unit.value = "miles";
    const onSubmit = renderCreateForm();

    await userEvent.type(screen.getByTestId("maf-test-form-avg-hr"), "140");
    await userEvent.type(screen.getByTestId("maf-test-form-distance"), "1");
    await userEvent.click(screen.getByTestId("maf-test-form-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.avgHeartRate).toBe(140);
    expect(submitted.durationSeconds).toBeNull();
    expect(submitted.distanceMeters).toBe(1609); // 1 mile → 1609 m
  });

  it("blocks submit and surfaces an error for an out-of-range heart rate", async () => {
    const onSubmit = renderCreateForm();

    // 12 bpm is below the 20 bpm floor.
    await submitAndExpectBlocked(onSubmit, "maf-test-form-avg-hr", "12");
  });

  it("rejects a malformed duration", async () => {
    const onSubmit = renderCreateForm();

    // 28:75 overflows the seconds field.
    await submitAndExpectBlocked(onSubmit, "maf-test-form-duration", "28:75");
  });
});
