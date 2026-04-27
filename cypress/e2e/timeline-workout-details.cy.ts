import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Timeline Workout Details Interactions", () => {
  const today = new Date().toISOString().split("T")[0];
  const workoutId = "timeline-entry-1";
  const planDayId = "plan-day-1";
  const loggedWorkoutId = "logged-workout-from-plan";
  const seededExerciseSets = [
    {
      id: "logged-set-1",
      workoutLogId: loggedWorkoutId,
      planDayId: null,
      exerciseName: "bench_press",
      customLabel: null,
      category: "strength",
      setNumber: 1,
      reps: 8,
      weight: 60,
      distance: null,
      time: null,
      plannedReps: 8,
      plannedWeight: 60,
      plannedDistance: null,
      plannedTime: null,
      notes: null,
      confidence: 95,
      sortOrder: 0,
    },
    {
      id: "logged-set-2",
      workoutLogId: loggedWorkoutId,
      planDayId: null,
      exerciseName: "overhead_press",
      customLabel: null,
      category: "strength",
      setNumber: 1,
      reps: 10,
      weight: 40,
      distance: null,
      time: null,
      plannedReps: 10,
      plannedWeight: 40,
      plannedDistance: null,
      plannedTime: null,
      notes: null,
      confidence: 95,
      sortOrder: 1,
    },
  ];

  const loggedWorkout = {
    id: loggedWorkoutId,
    userId: "test-user",
    date: today,
    focus: "Upper Body Strength",
    mainWorkout: "4x8 bench press at 60kg\n3x10 overhead press",
    accessory: "3x12 lateral raises",
    notes: null,
    duration: null,
    rpe: null,
    planDayId,
    planId: "plan-1",
    source: "manual",
    stravaActivityId: null,
    garminActivityId: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    exerciseSets: seededExerciseSets,
  };

  beforeEach(() => {
    cy.intercept("PATCH", `/api/v1/plans/days/${planDayId}/status`, {
      statusCode: 200,
      body: { id: planDayId, status: "completed" },
    }).as("updatePlanDay");

    cy.intercept("POST", "/api/v1/workouts", {
      statusCode: 200,
      body: loggedWorkout,
    }).as("logWorkoutFromPlan");

    cy.intercept("GET", `/api/v1/workouts/${loggedWorkoutId}`, {
      statusCode: 200,
      body: loggedWorkout,
    }).as("getLoggedWorkout");

    cy.intercept("GET", `/api/v1/workouts/${loggedWorkoutId}/history`, {
      statusCode: 200,
      body: {
        lastSameFocus: null,
        prSetCount: 0,
        blockAvgRpe: null,
      },
    }).as("getLoggedWorkoutHistory");

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

  it("opens the in-dialog guided logging stepper from the body CTA", () => {
    cy.getBySel(`card-timeline-entry-${workoutId}`).click();
    cy.wait("@getPlanDaySets");

    // Body-level CTA card is the primary entry point on the slimmed
    // planned-overview. The slimmed surface no longer shows the planned
    // exercise table or the stats grid — both move into stepper step 1.
    cy.getBySel("workout-detail-log-cta-button").should("be.visible");
    cy.getBySel("workout-detail-log-cta-button").click();

    cy.wait("@logWorkoutFromPlan");
    // Dialog stays open and re-renders into the 2-step stepper instead
    // of redirecting to /log. Step 1 (Log actuals) is active by default.
    cy.url().should("not.include", "/log");
    cy.getBySel("workout-detail-dialog-v2").should("exist");
    cy.getBySel("workout-logging-stepper").should("exist");
    cy.getBySel("workout-logging-step-1").should("have.attr", "aria-current", "step");
    cy.getBySel("exercise-table").should("be.visible");
    cy.getBySel("exercise-row").should("have.length", 2);
    cy.contains("Bench Press").should("exist");
    cy.contains("Overhead Press").should("exist");
    // Step 2 surfaces the RPE input + AthleteNoteInput once workoutId is
    // bound. The mutation onSuccess primes the workout-detail cache from
    // the API response so the inputs render without a separate GET.
    cy.getBySel("workout-logging-step-continue").click();
    cy.getBySel("workout-logging-step-2").should("have.attr", "aria-current", "step");
    cy.getBySel("workout-stats-rpe-review").should("be.visible").click();
    cy.getBySel("workout-stats-rpe-input").should("be.visible");
    cy.getBySel("athlete-note-input").should("exist");
    cy.getBySel("athlete-note-edit").should("not.be.disabled");
    cy.getBySel("workout-logging-step-finish").click();
    cy.getBySel("workout-logging-stepper").should("not.exist");
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
