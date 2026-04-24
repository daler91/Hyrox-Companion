import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Log Workout Submission", () => {
  beforeEach(() => {
    setupAuthIntercepts();

    // Intercept the POST request to save the workout
    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "new-workout-1", title: "My New Workout", date: new Date().toISOString() }
    }).as("saveWorkout");

    // Stub auto-parse to return no structured rows so the composer
    // stays in "text-only" mode for these submission tests. Without
    // this, a successful Gemini parse would populate exerciseBlocks
    // and flip the save path to structured.
    cy.intercept("POST", "/api/v1/parse-exercises", {
      statusCode: 200,
      body: [],
    }).as("parseExercises");

    cy.visit("/log");
    cy.wait("@authUser");
    cy.ensureConsentDismissed();
  });

  it("successfully logs a workout via free text", () => {
    // Open the describe/dictate panel
    cy.getBySel("workout-composer-toggle-text").click();

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

  it("saves with fallback title when no title is provided", () => {
    // Don't enter a title
    cy.getBySel("workout-composer-toggle-text").click();
    cy.getBySel("input-freetext").type("Some workout");

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    // Should save with fallback title "Workout"
    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body.title).to.eq("Workout");
    });

    cy.location("pathname").should("eq", "/");
  });

  it("shows an error when trying to save with no exercises and no free text", () => {
    cy.getBySel("input-workout-title").type("Title Only");

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
    cy.intercept("POST", "/api/v1/parse-exercises", {
      statusCode: 200,
      body: [],
    }).as("parseExercises");

    cy.visit("/log");
    cy.wait("@authUser");
    cy.ensureConsentDismissed();
  });

  it("successfully logs a workout with selected exercises", () => {
    // Fill the basic details
    cy.getBySel("input-workout-title").type("Leg Day");
    cy.getBySel("input-workout-notes").type("Squats felt heavy");

    // Open the picker and pick Back Squat. The draft table uses the
    // same ExerciseTable flow as the detail dialog: Add → picker →
    // select an exercise.
    cy.getBySel("exercise-table-add").click();
    cy.getBySel("exercise-add-dialog").should("exist");
    cy.getBySel("button-exercise-back_squat").click();

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

  it("shows an error when trying to save without any exercises or free text", () => {
    cy.getBySel("input-workout-title").type("Leg Day");

    // Do not select any exercises
    cy.getBySel("button-save-workout").click();

    cy.contains("Missing workout details").should("exist");
  });
});
