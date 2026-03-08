import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Navigation (Authenticated)", () => {
  beforeEach(() => {
    setupAuthIntercepts();
  });

  it("shows the sidebar", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.get("[data-sidebar='sidebar']").should("exist");
  });

  it("navigates to the log workout page", () => {
    cy.visit("/log");
    cy.wait("@authUser");
    cy.url().should("include", "/log");
  });

  it("navigates to the analytics page", () => {
    cy.visit("/analytics");
    cy.wait("@authUser");
    cy.url().should("include", "/analytics");
  });

  it("navigates to the settings page", () => {
    cy.visit("/settings");
    cy.wait("@authUser");
    cy.url().should("include", "/settings");
    cy.getBySel("button-save-settings").should("exist");
  });

  it("shows 404 for unknown routes", () => {
    cy.visit("/nonexistent-page");
    cy.wait("@authUser");
    cy.contains("404").should("be.visible");
  });
});
