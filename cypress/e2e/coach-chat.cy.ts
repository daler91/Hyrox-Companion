import { setupAuthIntercepts } from "../support/authIntercepts";

// Smoke coverage for the Coach panel. SSE streaming mocking in Cypress is
// fragile, so this tests the affordances rather than end-to-end stream
// consumption: panel opens, welcome renders, send button disabled on empty
// input, quick-action buttons visible.
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
  });

  // Set the onboarding-complete flag BEFORE the app bootstraps so the
  // wizard doesn't auto-open and block the coach FAB click. onBeforeLoad
  // runs on the app origin's window after navigation but before the
  // React app mounts.
  const visitWithOnboardingSkipped = (path: string) => {
    cy.visit(path, {
      onBeforeLoad: (win) => {
        win.localStorage.setItem("fitai-onboarding-complete", "true");
      },
    });
  };

  it("opens the coach panel from the floating action button", () => {
    visitWithOnboardingSkipped("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    // The chat input is only rendered once the panel is open, so this is a
    // tighter assertion than checking for the text "AI Coach" (which also
    // appears on the FAB itself).
    cy.getBySel("input-chat-message").should("be.visible");
  });

  it("disables the send button when the input is empty", () => {
    visitWithOnboardingSkipped("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    cy.get("[aria-label='Send message']").should("be.disabled");
  });

  it("renders quick-action buttons that athletes can tap", () => {
    visitWithOnboardingSkipped("/");
    cy.wait("@authUser");
    cy.wait("@timeline");

    cy.getBySel("button-coach-fab").click({ force: true });
    // At least one of the base quick actions should be present.
    cy.contains(
      "button",
      /workout suggestions|Analyze my training|Pacing tips|form tips/i,
    ).should("exist");
  });
});
