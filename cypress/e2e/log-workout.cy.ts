import { stubParseExercisesEmpty, visitLogWorkoutPage } from "../support/logWorkoutHelpers";

const visibleSelectors = [
  ["workout form with title input", "input-workout-title"],
  ["date input", "input-workout-date"],
  ["exercise table", "exercise-table"],
  ["composer with a describe/dictate panel", "workout-composer"],
  ["describe/dictate panel toggle", "workout-composer-toggle-text"],
  ["free-text area in the expanded panel", "input-freetext"],
  ["back button to return to timeline", "button-back"],
] as const;

function advanceToReflectStep() {
  cy.advanceLogWorkoutToReflect("3x10 squats");
}

describe("Log Workout Page", () => {
  beforeEach(() => {
    stubParseExercisesEmpty();
    visitLogWorkoutPage();
  });

  for (const [label, selector] of visibleSelectors) {
    it(`shows the ${label}`, () => {
      cy.getBySel(selector).should("exist");
    });
  }

  it("shows the notes input", () => {
    advanceToReflectStep();
    cy.getBySel("input-workout-notes").should("exist");
  });

  it("shows save workout button", () => {
    advanceToReflectStep();
    cy.getBySel("button-save-workout").should("exist");
  });

  it("lets the user proactively add an EMOM block in the confirm step", () => {
    cy.getBySel("input-freetext").type("3x10 squats");
    cy.getBySel("button-step-continue").click();
    cy.wait("@parseExercises");

    cy.getBySel("structure-blocks-editor").should("exist");
    cy.getBySel("structure-blocks-add-toggle").click();
    cy.getBySel("structure-blocks-add-emom").click();

    cy.getBySel("structure-block-0").should("exist");
    cy.getBySel("structure-block-0").contains("Block 1");
    cy.getBySel("structure-block-0").contains("EMOM");
  });
});
