import { setupAuthIntercepts } from "../support/authIntercepts";

// Local-timezone yyyy-MM-dd, mirroring client/src/lib/dateUtils.ts. Do NOT
// use toISOString().split("T")[0] here: the app's date strings are local-TZ,
// and the UTC slice lands on the wrong day for non-UTC runs near midnight.
function localDateString(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("Timeline Page", () => {
  describe("empty state", () => {
    beforeEach(() => {
      setupAuthIntercepts();
    });

    it("shows empty state prompt when no plans or workouts exist", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.wait("@plans");
      cy.getBySel("button-import-plan-empty").should("exist");
      cy.getBySel("button-log-workout-empty").should("exist");
    });

    it("shows the floating action button", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("button-log-workout-fab").should("exist");
      cy.getBySel("button-coach-fab").should("exist");
    });

    it("opens the AI coach panel when coach FAB is clicked", () => {
      // Skip onboarding before the app bootstraps so the wizard dialog doesn't
      // scroll-lock the body (pointer-events: none), which would otherwise make
      // the coach FAB un-clickable without forcing the interaction.
      cy.visit("/", {
        onBeforeLoad: (win) => {
          win.localStorage.setItem("fitai-onboarding-complete", "true");
        },
      });
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("button-coach-fab").should("be.visible").click();
      cy.getBySel("input-chat-message").should("exist");
    });
  });

  describe("with timeline data", () => {
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
            planName: "8 Week Fitness Plan",
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
          { id: "plan-1", name: "8 Week Fitness Plan", userId: "test-user-123" },
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

    it("shows the status filter", () => {
      cy.visit("/");
      cy.wait("@authUser");
      cy.wait("@timeline");
      cy.getBySel("select-filter").should("exist");
    });
  });

  describe("rest day landing", () => {
    const today = localDateString(0);

    beforeEach(() => {
      // A content-heavy history and nothing scheduled today: without the
      // injected today row + initial scroll, the page would sit at the top
      // of the list (a week ago) and today wouldn't exist at all.
      const pastLogs = Array.from({ length: 10 }, (_, i) => ({
        id: `log-${i + 1}`,
        date: localDateString(-(i + 1)),
        type: "logged",
        status: "completed",
        focus: `Session ${i + 1}`,
        mainWorkout: "5km tempo run in 24:30",
        accessory: "Core work",
        notes: "Felt strong",
        duration: 45,
        rpe: 7,
        workoutLogId: `wl-${i + 1}`,
      }));

      setupAuthIntercepts({
        timeline: [
          ...pastLogs,
          {
            id: "plan-day-1",
            date: localDateString(1),
            type: "planned",
            status: "planned",
            focus: "Upper Body Strength",
            mainWorkout: "4x8 bench press at 60kg",
            accessory: null,
            notes: null,
            planDayId: "pd-1",
            weekNumber: 1,
            dayName: "Monday",
            planName: "8 Week Fitness Plan",
            planId: "plan-1",
          },
        ],
        plans: [{ id: "plan-1", name: "8 Week Fitness Plan", userId: "test-user-123" }],
      });
    });

    it("lands on the injected today row without any user scrolling", () => {
      cy.visit("/", {
        onBeforeLoad: (win) => {
          win.localStorage.setItem("fitai-onboarding-complete", "true");
        },
      });
      cy.wait("@authUser");
      cy.wait("@timeline");

      // No cy.scrollTo/scrollIntoView before these assertions — the initial
      // scroll must land today in the viewport on its own.
      cy.getBySel(`timeline-date-group-${today}`).should(($el) => {
        const rect = $el[0].getBoundingClientRect();
        expect(rect.bottom, "today row bottom edge").to.be.greaterThan(0);
        expect(rect.top, "today row top edge").to.be.lessThan(
          Cypress.config("viewportHeight"),
        );
      });
      cy.getBySel("text-rest-day-today").should("be.visible");
    });
  });
});
