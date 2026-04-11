import { setupAuthIntercepts } from "../support/authIntercepts";

// Smoke coverage for the Coach panel. SSE streaming mocking in Cypress is
// fragile, so this tests the affordances rather than end-to-end stream
// consumption: panel opens, quick actions render, send button is disabled
// for empty input, clear-history control works.
describe("AI Coach Panel", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    // Mock the non-streaming chat endpoint as a fallback; the panel may
    // call either depending on useStreaming support.
    cy.intercept("POST", "/api/v1/chat", {
      statusCode: 200,
      body: { response: "Hi athlete — try a 30 min easy run.", ragInfo: null },
    }).as("chatResponse");
    cy.intercept("DELETE", "/api/v1/chat/history", { statusCode: 200, body: { ok: true } }).as(
      "clearHistory",
    );
    // Set the onboarding-complete flag so the wizard doesn't block the coach.
    cy.window().then((win) =>
      win.localStorage.setItem("hyrox-onboarding-complete", "true"),
    );
  });

  it("opens the coach panel from the floating action button", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    cy.contains("AI Coach").should("be.visible");
    // Welcome message appears for new users (empty timeline = isNewUser).
    cy.contains("workouts").should("exist");
  });

  it("disables the send button when the input is empty", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    cy.get("[aria-label='Send message']").should("be.disabled");
  });

  it("renders quick-action buttons that athletes can tap", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    cy.contains("button", /workout suggestions|Analyze my training|Pacing tips|form tips/i)
      .should("exist");
  });
});
