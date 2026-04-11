import { setupAuthIntercepts } from "../support/authIntercepts";

// E2E coverage for the plan generation dialog. Checks the entry point
// from the Timeline empty state and the multi-step dialog affordances.
// Backend generation is mocked so the test doesn't hit Gemini.
describe("Plan Generation", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    cy.intercept("POST", "/api/v1/plans/generate", {
      statusCode: 200,
      body: { id: "plan-123", name: "Mock Plan" },
    }).as("generatePlan");
    // Bypass onboarding so the Timeline empty state renders.
    cy.window().then((win) =>
      win.localStorage.setItem("hyrox-onboarding-complete", "true"),
    );
  });

  it("opens the generate dialog from the Timeline empty state", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
    cy.wait("@plans");

    cy.getBySel("button-generate-ai-plan").first().click();
    cy.contains("Generate AI Training Plan").should("be.visible");
    cy.contains("What's your training goal?").should("be.visible");
  });

  it("walks forward through the wizard steps", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
    cy.wait("@plans");

    cy.getBySel("button-generate-ai-plan").first().click();

    // Step 0 — Goal textarea is required to enable Next
    cy.get("textarea#goal").type("Prepare for Hyrox Doubles in 8 weeks");
    cy.contains("button", /Next/).click();

    // Step 1 — Weeks/Days/Rest Days labels appear
    cy.contains("Weeks").should("be.visible");
    cy.contains(/Days\/Week/i).should("be.visible");
    cy.contains("Experience Level").should("be.visible");
  });
});
