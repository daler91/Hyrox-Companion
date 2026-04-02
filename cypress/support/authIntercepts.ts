export function setupAuthIntercepts(overrides?: {
  timeline?: any[];
  plans?: any[];
  workouts?: any[];
  personalRecords?: any[];
  exerciseAnalytics?: any[];
  trainingOverview?: any;
  stravaStatus?: { connected: boolean; athleteId?: string; lastSyncedAt?: string | null };
  preferences?: { weightUnit: string; distanceUnit: string; weeklyGoal: number; emailNotifications: boolean };
}) {
  cy.intercept("GET", "/api/v1/auth/user", {
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

  cy.intercept("GET", "/api/v1/preferences", {
    statusCode: 200,
    body: overrides?.preferences ?? {
      weightUnit: "kg",
      distanceUnit: "km",
      weeklyGoal: 5,
      emailNotifications: true,
    },
  }).as("preferences");

  cy.intercept("GET", "/api/v1/timeline*", {
    statusCode: 200,
    body: overrides?.timeline ?? [],
  }).as("timeline");

  cy.intercept("GET", "/api/v1/plans", {
    statusCode: 200,
    body: overrides?.plans ?? [],
  }).as("plans");

  cy.intercept("GET", "/api/v1/workouts*", {
    statusCode: 200,
    body: overrides?.workouts ?? [],
  }).as("workouts");

  cy.intercept("GET", "/api/v1/personal-records*", {
    statusCode: 200,
    body: overrides?.personalRecords ?? {},
  }).as("records");

  cy.intercept("GET", "/api/v1/exercise-analytics*", {
    statusCode: 200,
    body: overrides?.exerciseAnalytics ?? {},
  }).as("exerciseAnalytics");

  cy.intercept("GET", "/api/v1/training-overview*", {
    statusCode: 200,
    body: overrides?.trainingOverview ?? {
      weeklySummaries: [],
      workoutDates: [],
      categoryTotals: {},
      stationCoverage: [],
    },
  }).as("trainingOverview");

  cy.intercept("GET", "/api/v1/strava/status", {
    statusCode: 200,
    body: overrides?.stravaStatus ?? { connected: false },
  }).as("stravaStatus");

  cy.intercept("GET", "/api/v1/exercise-history*", {
    statusCode: 200,
    body: [],
  }).as("exerciseHistory");

  cy.intercept("GET", "/api/v1/custom-exercises*", {
    statusCode: 200,
    body: [],
  }).as("customExercises");

  cy.intercept("GET", "/api/v1/chat/history", {
    statusCode: 200,
    body: [],
  }).as("chatHistory");
}
