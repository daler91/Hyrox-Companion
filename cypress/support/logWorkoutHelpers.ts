import { setupAuthIntercepts } from "./authIntercepts";

type SaveWorkoutResponse = {
  statusCode: number;
  body: {
    id: string;
    title: string;
    date: string;
  };
};

const defaultSaveWorkoutResponse = (): SaveWorkoutResponse => ({
  statusCode: 200,
  body: {
    id: "new-workout-1",
    title: "My New Workout",
    date: new Date().toISOString(),
  },
});

export const stubParseExercisesEmpty = () => {
  cy.intercept("POST", "/api/v1/parse-exercises", {
    statusCode: 200,
    body: [],
  }).as("parseExercises");
  cy.intercept("POST", "/api/v1/parse-workout-structure", {
    statusCode: 200,
    body: {
      exercises: [],
      structureBlocks: [],
      warnings: [],
      confidence: null,
    },
  }).as("parseExercises");
};

export const stubSaveWorkout = (responseOverride?: Partial<SaveWorkoutResponse>) => {
  const response: SaveWorkoutResponse = {
    ...defaultSaveWorkoutResponse(),
    ...responseOverride,
    body: {
      ...defaultSaveWorkoutResponse().body,
      ...responseOverride?.body,
    },
  };

  cy.intercept("POST", "/api/v1/workouts", response).as("saveWorkout");
};

export const visitLogWorkoutPage = () => {
  setupAuthIntercepts();
  cy.visit("/log");
  cy.wait("@authUser");
  cy.getBySel("input-workout-title").should("exist");
  cy.ensureConsentDismissed();
};
