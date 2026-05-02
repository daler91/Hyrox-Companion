import {
  stubParseExercisesEmpty,
  stubSaveWorkout,
  visitLogWorkoutPage,
} from "../support/logWorkoutHelpers";

describe("Log Workout Submission", () => {
  beforeEach(() => {
    stubSaveWorkout();
    stubParseExercisesEmpty();
    visitLogWorkoutPage();
  });

  it("successfully logs a workout via free text", () => {
    cy.getBySel("input-workout-title").type("Morning Training Run");
    cy.advanceLogWorkoutToReflect("5km tempo run\n4x10 pushups");

    cy.completeReflectAndSaveWorkout("Felt really good today!");

    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Morning Training Run",
        mainWorkout: "5km tempo run\n4x10 pushups",
        notes: "Felt really good today!",
      });
    });

    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("saves with fallback title when no title is provided", () => {
    // Text must include a digit/x to pass auto-parse signal gate.
    cy.advanceLogWorkoutToReflect("3x10 squats");
    cy.completeReflectAndSaveWorkout();

    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body.title).to.eq("Workout");
    });

    cy.location("pathname").should("eq", "/");
  });

  it("blocks progression with no exercises and no free text", () => {
    cy.getBySel("input-workout-title").type("Title Only");
    cy.getBySel("button-step-continue").should("be.disabled");
  });
});

describe("Log Workout Exercise Mode Submission", () => {
  beforeEach(() => {
    stubSaveWorkout({
      body: { id: "new-workout-2", title: "Exercise Mode Workout" },
    });
    stubParseExercisesEmpty();
    visitLogWorkoutPage();
  });

  it("successfully logs a workout with selected exercises", () => {
    cy.getBySel("input-workout-title").type("Leg Day");

    cy.getBySel("exercise-table-add").click();
    cy.getBySel("exercise-add-dialog").should("exist");
    cy.getBySel("button-exercise-back_squat").click();

    cy.advanceLogWorkoutToReflect("");

    cy.completeReflectAndSaveWorkout("Squats felt heavy");

    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Leg Day",
        notes: "Squats felt heavy",
      });
      expect(interception.request.body.exercises[0]).to.include({
        exerciseName: "back_squat",
      });
    });

    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("blocks progression without any exercises or free text", () => {
    cy.getBySel("input-workout-title").type("Leg Day");
    cy.getBySel("button-step-continue").should("be.disabled");
  });
});
