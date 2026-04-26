import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Log Workout Submission", () => {
  beforeEach(() => {
    setupAuthIntercepts();

    // Intercept the POST request to save the workout
    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "new-workout-1", title: "My New Workout", date: new Date().toISOString() },
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
    cy.getBySel("input-workout-title").should("exist");
    cy.ensureConsentDismissed();
  });

  it("successfully logs a workout via free text", () => {
    // Step 1: fill in details — panel starts expanded
    cy.getBySel("input-workout-title").type("Morning Training Run");
    cy.getBySel("input-freetext").type("5km tempo run\n4x10 pushups");

    // Navigate to step 2 (triggers parse)
    cy.getBySel("button-step-continue").click();
    cy.wait("@parseExercises");

    // Navigate to step 3
    cy.getBySel("button-step-continue").should("not.be.disabled").click();

    // Step 3: add notes, skip RPE, then save
    cy.getBySel("input-workout-notes").type("Felt really good today!");
    cy.getBySel("button-skip-rpe").click();

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    // Wait for the save request to be made and check the payload
    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Morning Training Run",
        mainWorkout: "5km tempo run\n4x10 pushups",
        notes: "Felt really good today!",
      });
    });

    // It should redirect to home/timeline
    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("saves with fallback title when no title is provided", () => {
    // Step 1: text only, no title
    cy.getBySel("input-freetext").type("Some workout");
    cy.getBySel("button-step-continue").click();
    cy.wait("@parseExercises");

    // Step 3
    cy.getBySel("button-step-continue").should("not.be.disabled").click();
    cy.getBySel("button-skip-rpe").click();

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    // Should save with fallback title "Workout"
    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body.title).to.eq("Workout");
    });

    cy.location("pathname").should("eq", "/");
  });

  it("blocks progression with no exercises and no free text", () => {
    // Title alone is not enough to proceed — Continue must be disabled
    cy.getBySel("input-workout-title").type("Title Only");
    cy.getBySel("button-step-continue").should("be.disabled");
  });
});

describe("Log Workout Exercise Mode Submission", () => {
  beforeEach(() => {
    setupAuthIntercepts();
    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "new-workout-2", title: "Exercise Mode Workout", date: new Date().toISOString() },
    }).as("saveWorkout");
    cy.intercept("POST", "/api/v1/parse-exercises", {
      statusCode: 200,
      body: [],
    }).as("parseExercises");

    cy.visit("/log");
    cy.wait("@authUser");
    cy.getBySel("input-workout-title").should("exist");
    cy.ensureConsentDismissed();
  });

  it("successfully logs a workout with selected exercises", () => {
    // Fill the basic details
    cy.getBySel("input-workout-title").type("Leg Day");

    // Add Back Squat via the exercise picker (available in step 1)
    cy.getBySel("exercise-table-add").click();
    cy.getBySel("exercise-add-dialog").should("exist");
    cy.getBySel("button-exercise-back_squat").click();

    // Navigate to step 2 (no text → no parse triggered)
    cy.getBySel("button-step-continue").click();

    // Navigate to step 3
    cy.getBySel("button-step-continue").should("not.be.disabled").click();

    // Step 3: add notes, skip RPE, then save
    cy.getBySel("button-skip-rpe").click();
    cy.getBySel("input-workout-notes").type("Squats felt heavy");

    cy.getBySel("button-save-workout").should("not.be.disabled").click();

    cy.wait("@saveWorkout").then((interception) => {
      expect(interception.request.body).to.include({
        title: "Leg Day",
        notes: "Squats felt heavy",
      });
      // Ensure exercises array is present and contains back_squat
      expect(interception.request.body.exercises[0]).to.include({
        exerciseName: "back_squat",
      });
    });

    cy.location("pathname").should("eq", "/");
    cy.contains("Workout logged").should("exist");
  });

  it("blocks progression without any exercises or free text", () => {
    // Title alone is not enough — Continue stays disabled
    cy.getBySel("input-workout-title").type("Leg Day");
    cy.getBySel("button-step-continue").should("be.disabled");
  });
});
