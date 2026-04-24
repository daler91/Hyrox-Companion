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

  it("shows the exercise table", () => {
    cy.getBySel("exercise-table").should("exist");
  });

  it("shows the composer with a describe/dictate panel toggle", () => {
    cy.getBySel("workout-composer").should("exist");
    cy.getBySel("workout-composer-toggle-text").should("exist");
  });

  it("reveals the free-text area when the describe/dictate panel is expanded", () => {
    cy.getBySel("workout-composer-toggle-text").click();
    cy.getBySel("input-freetext").should("exist");
  });

  it("shows save workout button", () => {
    cy.getBySel("button-save-workout").should("exist");
  });

  it("shows back button to return to timeline", () => {
    cy.getBySel("button-back").should("exist");
  });
});
