import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Log Workout Submission", () => {
  beforeEach(() => {
    setupAuthIntercepts();

    // Intercept the POST request to save the workout
    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "new-workout-1", title: "My New Workout", date: new Date().toISOString() }
    }).as("saveWorkout");

    cy.visit("/log");
    cy.wait("@authUser");
  });

  it("successfully logs a workout in free text mode", () => {
    // Switch to free text mode
    cy.getBySel("button-mode-freetext").click();

    // Fill out the basic details
    cy.getBySel("input-workout-title").type("Morning Training Run");

    // Fill the free text area
    cy.getBySel("input-freetext").type("5km tempo run\n4x10 pushups");

    // Add some notes
    cy.getBySel("input-workout-notes").type("Felt really good today!");

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    // Wait for the save request to be made and check the payload
    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Morning Training Run",
        mainWorkout: "5km tempo run\n4x10 pushups",
        notes: "Felt really good today!"
      });
    });

    // It should redirect to home/timeline
    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("shows an error when trying to save without a title", () => {
    // Don't enter a title
    cy.getBySel("button-mode-freetext").click();
    cy.getBySel("input-freetext").type("Some workout");

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    // Verify toast error
    cy.contains("Missing title").should("exist");
  });

  it("shows an error when trying to save empty free text", () => {
    cy.getBySel("input-workout-title").type("Title Only");
    cy.getBySel("button-mode-freetext").click();

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    cy.contains("Missing workout details").should("exist");
  });
});

describe("Log Workout Exercise Mode Submission", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "new-workout-2", title: "Exercise Mode Workout", date: new Date().toISOString() }
    }).as("saveWorkout");

    cy.visit("/log");
    cy.wait("@authUser");
  });

  it("successfully logs a workout with selected exercises", () => {
    // Fill the basic details
    cy.getBySel("input-workout-title").type("Leg Day");
    cy.getBySel("input-workout-notes").type("Squats felt heavy");

    // Click on an exercise to add it
    cy.getBySel("button-exercise-back_squat").click();

    // Since we added an exercise, the exercise details block should appear.
    // Let's assume there's a way to input sets. We can just save it with defaults.

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Leg Day",
        notes: "Squats felt heavy"
      });
      // Ensure exercises array is present and contains back_squat
      expect(interception.request.body.exercises[0]).to.include({
        exerciseName: "back_squat"
      });
    });

    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("shows an error when trying to save without any exercises", () => {
    cy.getBySel("input-workout-title").type("Leg Day");

    // Do not select any exercises
    cy.getBySel("button-save-workout").click();

    cy.contains("No exercises").should("exist");
  });
});
