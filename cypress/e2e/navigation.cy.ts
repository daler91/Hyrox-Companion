describe("Navigation (Authenticated)", () => {
  beforeEach(() => {
    cy.intercept("GET", "/api/auth/user", {
      statusCode: 200,
      body: {
        id: "test-user-123",
        username: "testathlete",
        profileImageUrl: null,
        email: "test@example.com",
      },
    }).as("authUser");

    cy.intercept("GET", "/api/preferences", {
      statusCode: 200,
      body: {
        weightUnit: "kg",
        distanceUnit: "km",
        weeklyGoal: 5,
        emailNotifications: false,
      },
    }).as("preferences");

    cy.intercept("GET", "/api/timeline*", {
      statusCode: 200,
      body: [],
    }).as("timeline");

    cy.intercept("GET", "/api/plans", {
      statusCode: 200,
      body: [],
    }).as("plans");

    cy.intercept("GET", "/api/workouts*", {
      statusCode: 200,
      body: [],
    }).as("workouts");

    cy.intercept("GET", "/api/personal-records", {
      statusCode: 200,
      body: [],
    }).as("records");

    cy.intercept("GET", "/api/exercise-analytics*", {
      statusCode: 200,
      body: [],
    }).as("exerciseAnalytics");

    cy.intercept("GET", "/api/strava/status", {
      statusCode: 200,
      body: { connected: false },
    }).as("stravaStatus");

    cy.intercept("GET", "/api/exercise-history*", {
      statusCode: 200,
      body: [],
    }).as("exerciseHistory");
  });

  it("shows the sidebar with navigation links", () => {
    cy.visit("/");
    cy.wait("@authUser");
    cy.get("nav").should("be.visible");
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
    cy.getBySel("button-save-settings").should("be.visible");
  });

  it("shows 404 for unknown routes", () => {
    cy.visit("/nonexistent-page");
    cy.wait("@authUser");
    cy.contains("404").should("be.visible");
  });
});
