import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockAthleteFact } from "../../../../../test/factories";
import { GeneratePlanDetailsStep } from "./GeneratePlanDetailsStep";

function renderStep(cardFacts = [createMockAthleteFact()]) {
  return render(
    <GeneratePlanDetailsStep
      focusAreas={[]}
      onFocusToggle={vi.fn()}
      cardFacts={cardFacts}
      injuries=""
      onInjuriesChange={vi.fn()}
      onBack={vi.fn()}
      onGenerate={vi.fn()}
      canGenerate
      isGenerating={false}
    />,
  );
}

// Coach-memory spec, Path C: the athlete sees what every plan is already
// written around, and the box adds to it rather than restating it.
describe("GeneratePlanDetailsStep — the athlete card", () => {
  it("lists what the coach already knows and asks only for anything else", () => {
    renderStep([createMockAthleteFact(), createMockAthleteFact({ id: "f2", fact: "Bad left knee" })]);

    const card = screen.getByRole("region", { name: "Your coach already knows" });
    expect(within(card).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "No sled at my gym",
      "Bad left knee",
    ]);
    const box = screen.getByLabelText("Anything else to program around? (optional)");
    expect(box).toHaveAccessibleDescription(expect.stringContaining("saved to your athlete card"));
  });

  it("asks about injuries and limitations when the card is empty", () => {
    renderStep([]);

    expect(screen.queryByRole("region", { name: "Your coach already knows" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Injuries or Limitations (optional)")).toBeInTheDocument();
  });
});
