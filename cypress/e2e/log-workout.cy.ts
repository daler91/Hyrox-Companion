import { stubParseExercisesEmpty, visitLogWorkoutPage } from "../support/logWorkoutHelpers";

describe("Log Workout Page", () => {
  beforeEach(() => {
    stubParseExercisesEmpty();
    visitLogWorkoutPage();
  });

  it("shows the workout form with title input", () => {
    cy.getBySel("input-workout-title").should("exist");
  });

  it("shows the date input", () => {
    cy.getBySel("input-workout-date").should("exist");
  });

  it("shows the notes input", () => {
    // Notes live on step 3 — navigate there via the stepper.
    // Text must be ≥8 chars AND contain a digit/x to satisfy
    // the auto-parse signal gate (useWorkoutEditor#AUTO_PARSE_SIGNAL_RE).
    cy.advanceLogWorkoutToReflect("3x10 squats");
    cy.getBySel("input-workout-notes").should("exist");
  });

  it("shows the exercise table", () => {
    cy.getBySel("exercise-table").should("exist");
  });

  it("shows the composer with a describe/dictate panel toggle", () => {
    cy.getBySel("workout-composer").should("exist");
    cy.getBySel("workout-composer-toggle-text").should("exist");
  });

  it("shows the free-text area in the expanded panel", () => {
    // The describe/dictate panel starts expanded on step 1
    cy.getBySel("input-freetext").should("exist");
  });

  it("shows save workout button", () => {
    // Save button lives on step 3 — navigate there
    cy.advanceLogWorkoutToReflect("3x10 squats");
    cy.getBySel("button-save-workout").should("exist");
  });

  it("shows back button to return to timeline", () => {
    cy.getBySel("button-back").should("exist");
  });

  it("surfaces the structured-blocks card in the capture step", () => {
    cy.getBySel("structured-blocks-card").should("be.visible");
    cy.getBySel("structure-blocks-add-emom").should("be.visible");
  });

  it("lets the user add an EMOM block from the capture step and continue without free text", () => {
    cy.getBySel("structure-blocks-add-emom").click();
    cy.getBySel("structure-block-0").should("exist");

    // Continue is enabled purely by the structureBlock — no free text typed.
    cy.getBySel("button-step-continue").should("not.be.disabled").click();
    cy.getBySel("structured-blocks-card").should("be.visible");
    cy.getBySel("structure-block-0").should("exist");
  });

  it("lets the user proactively add an EMOM block in the confirm step", () => {
    cy.getBySel("input-freetext").type("3x10 squats");
    cy.getBySel("button-step-continue").click();
    cy.wait("@parseExercises");

    cy.getBySel("structured-blocks-card").should("be.visible");
    cy.getBySel("structure-blocks-add-emom").click();

    cy.getBySel("structure-block-0").should("exist");
    cy.getBySel("structure-block-0").contains(/EMOM is configured as a block/i);
  });
});
