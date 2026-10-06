import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { type MafCategoryInput, TrainingStyleSection } from "../TrainingStyleSection";

installRadixPointerMocks();

const handlers = {
  onTrainingStyleIdChange: vi.fn<(value: string) => void>(),
  onMafAgeInputChange: vi.fn<(value: string) => void>(),
  onMafCategoryInputChange: vi.fn<(value: MafCategoryInput) => void>(),
  onMafHrDataAvailableInputChange: vi.fn<(value: "" | "yes" | "no") => void>(),
};

interface SectionSetup {
  readonly trainingStyleId: string;
  readonly mafAgeInput: string;
  readonly mafCategoryInput: MafCategoryInput;
}

function renderSection({ trainingStyleId, mafAgeInput, mafCategoryInput }: SectionSetup) {
  return render(
    <TrainingStyleSection
      trainingStyleId={trainingStyleId}
      hasRequiredMafInputs={Boolean(mafAgeInput && mafCategoryInput)}
      mafHr={null}
      mafAgeInput={mafAgeInput}
      mafCategoryInput={mafCategoryInput}
      mafHrDataAvailableInput=""
      styleAuditEntries={[]}
      {...handlers}
    />,
  );
}

/** Open a Radix select by its label and pick an option. */
async function chooseOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/** Pick a new style and wait for the "Change training style?" prompt. */
async function startStyleSwitch(option: string) {
  await chooseOption("Training style", option);
  expect(
    await screen.findByRole("heading", { name: "Change training style?" }),
  ).toBeInTheDocument();
}

async function expectDialogClosed(name: string) {
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
  });
}

const MAF_ATHLETE: SectionSetup = {
  trainingStyleId: "maf_method",
  mafAgeInput: "40",
  mafCategoryInput: "consistent_up_to_2y",
};

describe("TrainingStyleSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CL38 (CODEBASE_ANALYSIS_2026-10-03): the cancelled switch stayed pending,
  // so a later "Save MAF setup" took the athlete off MAF.
  it("does not apply a cancelled style switch when the MAF setup is saved later", async () => {
    renderSection(MAF_ATHLETE);

    await startStyleSwitch("Balanced");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expectDialogClosed("Change training style?");

    fireEvent.click(screen.getByTestId("button-maf-setup"));
    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save MAF setup" }));
    await expectDialogClosed("Complete MAF setup");

    expect(handlers.onMafAgeInputChange).toHaveBeenCalledWith("40");
    expect(handlers.onTrainingStyleIdChange).not.toHaveBeenCalled();
  });

  it("does not apply a switch to MAF whose setup was cancelled", async () => {
    const view = renderSection({
      trainingStyleId: "balanced_default",
      mafAgeInput: "",
      mafCategoryInput: "",
    });

    await startStyleSwitch("MAF Method");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expectDialogClosed("Complete MAF setup");

    // MAF arrives another way (another tab's save); editing its setup must
    // not replay the abandoned switch.
    view.rerender(
      <TrainingStyleSection
        trainingStyleId="maf_method"
        hasRequiredMafInputs
        mafHr={null}
        mafAgeInput="40"
        mafCategoryInput="consistent_up_to_2y"
        mafHrDataAvailableInput=""
        styleAuditEntries={[]}
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByTestId("button-maf-setup"));
    fireEvent.click(await screen.findByRole("button", { name: "Save MAF setup" }));
    await expectDialogClosed("Complete MAF setup");

    expect(handlers.onTrainingStyleIdChange).not.toHaveBeenCalled();
  });

  it("applies a switch to MAF once its setup is saved", async () => {
    renderSection({ trainingStyleId: "balanced_default", mafAgeInput: "", mafCategoryInput: "" });

    await startStyleSwitch("MAF Method");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { name: "Complete MAF setup" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("maf-age-input"), { target: { value: "39" } });
    await chooseOption(
      "Health and training category",
      "Training consistently (up to 2 years) without those problems",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save MAF setup" }));

    await waitFor(() => {
      expect(handlers.onTrainingStyleIdChange).toHaveBeenCalledWith("maf_method");
    });
    expect(handlers.onMafAgeInputChange).toHaveBeenCalledWith("39");
  });

  it("applies a confirmed switch straight away when nothing is missing", async () => {
    renderSection(MAF_ATHLETE);

    await startStyleSwitch("Balanced");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(handlers.onTrainingStyleIdChange).toHaveBeenCalledWith("balanced_default");
    });
  });
});
