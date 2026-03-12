import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Timeline Page", () => {
  describe("empty state", () => {
    beforeEach(() => {
      setupAuthIntercepts();
    });

    it("shows empty state prompt when no plans or workouts exist", () => {
      cy.visit("/", {
        onBeforeLoad: (win) => {
          win.localStorage.setItem("hyrox-onboarding-complete", "true");
        }
      });
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.wait("@plans");
      cy.getBySel("button-import-plan-empty").should("exist");
      cy.getBySel("button-log-workout-empty").should("exist");
    });

    it("shows the floating action button", () => {
      cy.visit("/", {
        onBeforeLoad: (win) => {
          win.localStorage.setItem("hyrox-onboarding-complete", "true");
        }
      });
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("button-log-workout-fab").should("exist");
      cy.getBySel("button-coach-fab").should("exist");
    });

    it("opens the AI coach panel when coach FAB is clicked", () => {
      cy.visit("/", {
        onBeforeLoad: (win) => {
          win.localStorage.setItem("hyrox-onboarding-complete", "true");
        }
      });
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("button-coach-fab").click();
      cy.getBySel("input-chat-message").should("exist");
    });
  });

  describe("with timeline data", () => {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    beforeEach(() => {
      setupAuthIntercepts({
        timeline: [
          {
            id: "plan-day-1",
            date: tomorrow,
            type: "planned",
            status: "planned",
            focus: "Upper Body Strength",
            mainWorkout: "4x8 bench press at 60kg",
            accessory: null,
            notes: null,
            planDayId: "pd-1",
            weekNumber: 1,
            dayName: "Monday",
            planName: "8 Week Hyrox Prep",
            planId: "plan-1",
          },
          {
            id: "log-1",
            date: yesterday,
            type: "logged",
            status: "completed",
            focus: "Running",
            mainWorkout: "5km tempo run in 24:30",
            accessory: "Core work",
            notes: "Felt strong",
            duration: 45,
            rpe: 7,
            workoutLogId: "wl-1",
          },
        ],
        plans: [
          { id: "plan-1", name: "8 Week Hyrox Prep", userId: "test-user-123" },
        ],
      });
    });

    it("displays timeline entries", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.contains("Upper Body Strength").should("exist");
      cy.contains("Running").should("exist");
    });

    it("shows the plan filter dropdown", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("select-plan").should("exist");
    });

    it("shows the jump to today button", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("button-jump-to-today").should("exist");
    });

    it("shows the status filter", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("select-filter").should("exist");
    });
  });
});
