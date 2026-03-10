import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Log Workout Page", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    cy.visit("/log");
    cy.wait("@authUser");
  });

  it("shows the workout form with title input", () => {
    cy.getBySel("input-workout-title").should("exist");
  });

  it("shows the date input", () => {
    cy.getBySel("input-workout-date").should("exist");
  });

  it("shows the notes input", () => {
    cy.getBySel("input-workout-notes").should("exist");
  });

  it("shows the exercise selector", () => {
    cy.getBySel("exercise-selector").should("exist");
  });

  it("shows mode toggle buttons for exercises and free text", () => {
    cy.getBySel("button-mode-exercises").should("exist");
    cy.getBySel("button-mode-freetext").should("exist");
  });

  it("shows free text area when free text mode is selected", () => {
    cy.getBySel("button-mode-freetext").click();
    cy.getBySel("input-freetext").should("exist");
    cy.getBySel("button-parse-ai").should("exist");
  });

  it("shows save workout button", () => {
    cy.getBySel("button-save-workout").should("exist");
  });

  it("shows back button to return to timeline", () => {
    cy.getBySel("button-back").should("exist");
  });
});
