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
  });

  // Cypress 12+ clears localStorage per test, so the wizard triggers
  // automatically on Timeline mount without any setup.
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

    // Step 2 — Units. Only answers that differ from the saved preferences
    // are written (audit H2), so pick one to make the save deterministic.
    cy.contains("Set Your Preferences").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 2 of");
    cy.contains("label", "Men").click();
    cy.contains("button", "Continue").click();
    cy.wait("@savePreferences").its("request.body").should("include", { gender: "male" });

    // Step 3 — Goal. Left as saved, so nothing is written.
    cy.contains("What's Your Goal?").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 3 of");
    cy.contains("button", "Continue").click();

    // Step 4 — Fuelling (optional; present because the nutrition module is on
    // by default). Leaving it blank skips without saving anything.
    cy.contains("Fuel Your Training").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 4 of");
    cy.getBySel("input-fuelling-bodyweight").should("be.visible");
    cy.contains("button", "Continue").click();

    // Step 5 — AI Coach: an explicit choice, off until the athlete turns it
    // on; choosing "on" shows what it sends (audit M6). Left off here.
    cy.contains("Meet Your AI Coach").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 5 of");
    cy.getBySel("radio-coach-off").should("have.attr", "aria-checked", "true");
    cy.getBySel("radio-coach-on").click();
    cy.contains("Your recent workout history").should("be.visible");
    cy.getBySel("radio-coach-off").click();
    cy.contains("button", "Continue").click();

    // Step 6 — Plan. The AI Coach was left off, so the template leads and the
    // AI option says it needs the coach (audit C1).
    cy.contains("Choose Your Path").should("be.visible");
    cy.getBySel("text-onboarding-step-count").should("contain", "Step 6 of");
    cy.getBySel("button-onboarding-sample-plan").should("be.visible");
    cy.getBySel("button-onboarding-generate-plan")
      .should("be.visible")
      .and("contain", "Needs the AI Coach");
    cy.getBySel("button-onboarding-skip").should("be.visible");
  });

  it("asks for AI consent before the AI plan steps when the coach is off", () => {
    cy.intercept("GET", "/api/v1/auth/user", {
      statusCode: 200,
      body: { id: "test-user-123", email: "test@example.com", aiCoachEnabled: false },
    }).as("authUser");
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
    cy.wait("@plans");

    cy.contains("button", "Get Started").click();
    cy.contains("Set Your Preferences").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("What's Your Goal?").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("Fuel Your Training").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("Meet Your AI Coach").should("be.visible");
    cy.contains("button", "Continue").click();

    // The generator asks first instead of failing with a 403 after three steps.
    // Its own alias: an en-US browser may already have saved suggested units.
    cy.intercept("PATCH", "/api/v1/preferences", { statusCode: 200, body: { ok: true } }).as(
      "enableAiCoach",
    );
    cy.getBySel("button-onboarding-generate-plan").click();
    cy.contains("AI plans are written by the AI Coach").should("be.visible");
    cy.getBySel("button-generate-enable-ai").click();
    cy.wait("@enableAiCoach").its("request.body").should("deep.equal", { aiCoachEnabled: true });
    cy.get("textarea#goal").should("be.visible");
  });

  it("can skip onboarding and close the wizard", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
    cy.wait("@plans");

    // Walk to the Plan step. Nothing is changed on the way, so nothing is saved.
    cy.contains("button", "Get Started").click();
    cy.contains("Set Your Preferences").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("What's Your Goal?").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("Fuel Your Training").should("be.visible");
    cy.contains("button", "Continue").click();
    cy.contains("Meet Your AI Coach").should("be.visible");
    cy.contains("button", "Continue").click();

    cy.getBySel("button-onboarding-skip").click();
    cy.contains("Choose Your Path").should("not.exist");
  });

  it("exposes a Run setup again button on Settings", () => {
    // The Settings page doesn't mount useOnboarding, so the wizard won't
    // auto-open here regardless of localStorage state.
    cy.visit("/settings");
    cy.wait("@authUser");

    // The Getting Started card sits below the Profile / Strava /
    // Preferences cards, which pushes the button below the 720px viewport
    // on the Cypress default. scrollIntoView first so be.visible is
    // meaningful (otherwise Cypress flags the element as "clipped by
    // overflow: auto" on the main scroll container).
    cy.getBySel("button-rerun-onboarding").scrollIntoView();
    cy.getBySel("button-rerun-onboarding").should("be.visible");
    cy.getBySel("button-rerun-onboarding").click();

    // Landing back on Timeline with onboarding forced open via the URL param.
    cy.url().should("match", /(?:\/\?onboarding=run|\/$)/);
    cy.wait("@timeline");
    cy.contains("Welcome to fitai.coach").should("be.visible");
  });
});
