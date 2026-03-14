import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Timeline Workout Details Interactions", () => {
  const today = new Date().toISOString().split("T")[0];
  const workoutId = "timeline-entry-1";
  const planDayId = "plan-day-1";

  beforeEach(() => {
    // Intercept PATCH for plan days marking complete
    cy.intercept("PATCH", `/api/plans/days/${planDayId}/status`, {
      statusCode: 200,
      body: { id: planDayId, status: "completed" },
    }).as("updatePlanDay");

    cy.intercept("PATCH", `/api/plans/*/days/${planDayId}`, {
      statusCode: 200,
      body: { id: planDayId, focus: "Updated Upper Body Focus" },
    }).as("updateDayDetails");

    // Intercept POST for saving updated details
    cy.intercept("POST", "/api/workouts", {
      statusCode: 200,
      body: { id: "logged-workout-from-plan", title: "Upper Body Strength" },
    }).as("logWorkoutFromPlan");

    // Intercept DELETE for deleting a workout
    cy.intercept("DELETE", `/api/plans/days/${planDayId}`, {
      statusCode: 200,
      body: { success: true },
    }).as("deleteWorkout");

    setupAuthIntercepts({
      timeline: [
        {
          id: workoutId,
          date: today,
          type: "planned",
          status: "planned",
          focus: "Upper Body Strength",
          mainWorkout: "4x8 bench press at 60kg\n3x10 overhead press",
          accessory: "3x12 lateral raises",
          notes: "Focus on form",
          planDayId: planDayId,
          weekNumber: 1,
          dayName: "Monday",
          planName: "8 Week Hyrox Prep",
          planId: "plan-1",
        },
      ],
    });

    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
  });

  it("opens the detail dialog when clicking a workout card", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    // Verify dialog contents
    cy.contains("Upper Body Strength").should("exist");
    cy.contains("4x8 bench press at 60kg").should("exist");
    cy.contains("3x12 lateral raises").should("exist");
    cy.contains("Focus on form").should("exist");
  });

  it("can mark a planned workout as complete from the card directly", () => {
    // The "Complete" button should be visible on the card
    cy.getBySel(`button-complete-${workoutId}`).click();

    // Verify the API was called with the "completed" status
    cy.wait("@logWorkoutFromPlan");

    // It should also show a toast
    cy.contains("Workout logged").should("exist");
  });

  it("can mark a workout as missed from the detail dialog", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    // The dialog actions has a 'Mark Missed' button
    cy.getBySel("button-detail-missed").click();

    // Verify API call
    cy.wait("@updatePlanDay").then((interception) => {
      expect(interception.request.body).to.include({ status: "missed" });
    });

    cy.contains("Status updated").should("exist");
  });

  it("can save edited details from the detail dialog", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    // Switch to editing mode
    cy.getBySel("button-detail-edit").click();

    // Change some details
    cy.getBySel("input-detail-focus").clear().type("Updated Upper Body Focus");
    cy.getBySel("input-detail-main").clear().type("New main workout content");

    // Save changes
    cy.getBySel("button-detail-save").click();

    cy.wait("@updateDayDetails").then((interception) => {
      expect(interception.request.body).to.include({
        focus: "Updated Upper Body Focus",
        mainWorkout: "New main workout content",
      });
    });

    cy.contains("Entry updated").should("exist");
  });

  it("can delete a workout from the detail dialog", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    // The dialog actions has a 'Delete' button
    cy.getBySel("button-detail-delete").click();

    // A confirmation dialog should appear
    cy.getBySel("button-confirm-delete").should("be.visible").click({ force: true });

    // Verify DELETE API was called
    cy.wait("@deleteWorkout");

    cy.contains("Workout removed from plan").should("exist");
  });
});
