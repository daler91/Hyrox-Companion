import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Timeline Workout Details Interactions", () => {
  const today = new Date().toISOString().split("T")[0];
  const workoutId = "timeline-entry-1";
  const planDayId = "plan-day-1";

  beforeEach(() => {
    cy.intercept("PATCH", `/api/v1/plans/days/${planDayId}/status`, {
      statusCode: 200,
      body: { id: planDayId, status: "completed" },
    }).as("updatePlanDay");

    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: { id: "logged-workout-from-plan", title: "Upper Body Strength" },
    }).as("logWorkoutFromPlan");

    cy.intercept("DELETE", `/api/v1/plans/days/${planDayId}`, {
      statusCode: 200,
      body: { success: true },
    }).as("deleteWorkout");

    // V2 planned-state renders an editable ExerciseTable for the plan
    // day — stub the new endpoint so the dialog doesn't 404 when it
    // opens on a planned entry.
    cy.intercept("GET", `/api/v1/plans/days/${planDayId}/sets`, {
      statusCode: 200,
      body: [],
    }).as("getPlanDaySets");

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
          planName: "8 Week Fitness Plan",
          planId: "plan-1",
        },
      ],
    });

    cy.visit("/");
    cy.wait("@authUser");
    cy.wait("@timeline");
  });

  it("opens the v2 detail dialog when clicking a workout card", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    cy.getBySel("workout-detail-dialog-v2").should("exist");
    cy.contains("Upper Body Strength").should("exist");
    // Coach's Prescription accordion opens by default on planned entries,
    // so the free-text content is visible without a toggle.
    cy.contains("4x8 bench press at 60kg").should("exist");
    cy.contains("3x12 lateral raises").should("exist");
    cy.contains("Focus on form").should("exist");
  });

  it("can mark a planned workout as complete from the card directly", () => {
    cy.getBySel(`button-complete-${workoutId}`).click();

    cy.wait("@logWorkoutFromPlan");
    cy.contains("Workout logged").should("exist");
  });

  it("can mark a planned workout as complete from the dialog's CTA", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();
    cy.getBySel("workout-detail-mark-complete").click();

    cy.wait("@logWorkoutFromPlan");
    cy.contains("Workout logged").should("exist");
  });

  it("can mark a workout as missed from the v2 overflow menu", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    // Status change moved from the ⋮ menu to the clickable status chip.
    cy.getBySel("workout-detail-status-chip").click();
    cy.getBySel("workout-detail-status-missed").click();

    cy.wait("@updatePlanDay").then((interception) => {
      expect(interception.request.body).to.include({ status: "missed" });
    });

    cy.contains("Status updated").should("exist");
  });

  it("can delete a planned workout from the v2 overflow menu", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();

    cy.getBySel("workout-detail-actions-trigger").click();
    cy.getBySel("workout-detail-delete").click();

    // v2 confirm step lives on the AlertDialog we mount alongside the
    // main Dialog; "Delete" is the confirm action on that overlay.
    cy.getBySel("workout-detail-delete-confirm").click({ force: true });

    cy.wait("@deleteWorkout");
    cy.contains("Workout removed from plan").should("exist");
  });

  // NOTE: the legacy "can save edited details from the detail dialog"
  // suite is intentionally dropped. V2 renders focus/mainWorkout/
  // accessory/notes read-only in the CoachPrescriptionCollapsible;
  // inline editing of those free-text fields is tracked as a follow-up
  // (see PR #839 body → "Follow-ups").
});
