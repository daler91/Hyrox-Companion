import { setupAuthIntercepts } from "../support/authIntercepts";

// E2E coverage for the first-time onboarding flow, the new "Step N of N"
// counter, and the re-entry point added to Settings. Covers findings
// O-1..O-4 from the UX review.
describe("Onboarding Wizard", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    cy.intercept("PATCH", "/api/v1/preferences", { statusCode: 200, body: { ok: true } }).as(
      "savePreferences",
    );
    // Ensure the onboarding-complete localStorage flag is cleared so the
    // wizard triggers on Timeline mount.
    cy.window().then((win) => win.localStorage.removeItem("hyrox-onboarding-complete"));
  });

  it("shows the wizard on first load and walks through the first few steps", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
    cy.wait("@plans");

    // Step 1 — Welcome
    cy.contains("Welcome to fitai.coach").should("be.visible");
    cy.getBySel("text-onboarding-step-count")
      .should("be.visible")
      .and("contain", "Step 1 of");
    cy.contains("button", "Get Started").click();

    // Step 2 — Units
    cy.contains("Set Your Preferences").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 2 of");
    cy.contains("button", "Continue").click();
    cy.wait("@savePreferences");

    // Step 3 — Goal
    cy.contains("What's Your Goal?").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 3 of");
    cy.contains("button", "Continue").click();

    // Step 4 — Plan
    cy.contains("Choose Your Path").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 4 of");
    // 8-Week Sample Plan should be the primary CTA now (default button variant).
    cy.getBySel("button-onboarding-sample-plan").should("be.visible");
    cy.getBySel("button-onboarding-generate-plan").should("be.visible");
    cy.getBySel("button-onboarding-skip").should("be.visible");
  });

  it("can skip onboarding and close the wizard", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@plans");

    // Walk to the Plan step
    cy.contains("button", "Get Started").click();
    cy.contains("button", "Continue").click();
    cy.wait("@savePreferences");
    cy.contains("button", "Continue").click();

    cy.getBySel("button-onboarding-skip").click();
    cy.contains("Choose Your Path").should("not.exist");
  });

  it("exposes a Run setup again button on Settings", () => {
    // Complete onboarding in storage so the wizard doesn't auto-show on visit.
    cy.window().then((win) =>
      win.localStorage.setItem("hyrox-onboarding-complete", "true"),
    );

    cy.visit("/settings");
    cy.wait("@authUser");

    cy.getBySel("button-rerun-onboarding").should("be.visible");
    cy.getBySel("button-rerun-onboarding").click();

    // Landing back on Timeline with onboarding forced open.
    cy.url().should("include", "/");
    cy.wait("@timeline");
    cy.contains("Welcome to fitai.coach").should("be.visible");
  });
});
