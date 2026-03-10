export function setupAuthIntercepts(overrides?: {
  timeline?: any[];
  plans?: any[];
  workouts?: any[];
  personalRecords?: any[];
  exerciseAnalytics?: any[];
  stravaStatus?: { connected: boolean; athleteId?: string; lastSyncedAt?: string | null };
  preferences?: { weightUnit: string; distanceUnit: string; weeklyGoal: number; emailNotifications: number };
}) {
  cy.intercept("GET", "/api/auth/user", {
    statusCode: 200,
    body: {
      id: "test-user-123",
      username: "testathlete",
      firstName: "Test",
      lastName: "Athlete",
      profileImageUrl: null,
      email: "test@example.com",
    },
  }).as("authUser");

  cy.intercept("GET", "/api/preferences", {
    statusCode: 200,
    body: overrides?.preferences ?? {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: 1,
    },
  }).as("preferences");

  cy.intercept("GET", "/api/timeline*", {
    statusCode: 200,
    body: overrides?.timeline ?? [],
  }).as("timeline");

  cy.intercept("GET", "/api/plans", {
    statusCode: 200,
    body: overrides?.plans ?? [],
  }).as("plans");

  cy.intercept("GET", "/api/workouts*", {
    statusCode: 200,
    body: overrides?.workouts ?? [],
  }).as("workouts");

  cy.intercept("GET", "/api/personal-records*", {
    statusCode: 200,
    body: overrides?.personalRecords ?? {},
  }).as("records");

  cy.intercept("GET", "/api/exercise-analytics*", {
    statusCode: 200,
    body: overrides?.exerciseAnalytics ?? {},
  }).as("exerciseAnalytics");

  cy.intercept("GET", "/api/strava/status", {
    statusCode: 200,
    body: overrides?.stravaStatus ?? { connected: false },
  }).as("stravaStatus");

  cy.intercept("GET", "/api/exercise-history*", {
    statusCode: 200,
    body: [],
  }).as("exerciseHistory");

  cy.intercept("GET", "/api/custom-exercises", {
    statusCode: 200,
    body: [],
  }).as("customExercises");

  cy.intercept("GET", "/api/chat/history", {
    statusCode: 200,
    body: [],
  }).as("chatHistory");
}
