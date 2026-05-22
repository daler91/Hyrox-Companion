import { setupAuthIntercepts } from "../support/authIntercepts";

const stationCoverage = ([
  ["skierg", "2024-03-11", 4],
  ["sled_push", "2024-03-08", 7],
  ["sled_pull", "2024-03-02", 13],
  ["burpee_broad_jump", "2024-02-25", 19],
  ["rowing", "2024-03-12", 3],
  ["farmers_carry", "2024-02-20", 24],
  ["sandbag_lunges", "2024-03-04", 11],
  ["wall_balls", "2024-03-10", 5],
  ["running", "2024-03-14", 1],
] as const).map(([station, lastTrained, daysSince]) => ({ station, lastTrained, daysSince }));

const weekStarts = [
  "2024-01-01",
  "2024-01-08",
  "2024-01-15",
  "2024-01-22",
  "2024-01-29",
  "2024-02-05",
  "2024-02-12",
  "2024-02-19",
  "2024-02-26",
  "2024-03-04",
  "2024-03-11",
  "2024-03-18",
];

const workoutCounts = [4, 5, 6, 7, 5, 8, 6, 7, 9, 8, 10, 6];
const avgRpes = [5.5, 5.7, 6.1, 6.2, 5.6, 6.8, 6.0, 6.4, 7.0, 6.7, 7.2, 6.3];

const weeklySummaries = weekStarts.map((weekStart, index) => {
  const workoutCount = workoutCounts[index] ?? 0;
  return {
    weekStart,
    workoutCount,
    totalDuration: workoutCount * 60,
    avgRpe: avgRpes[index] ?? null,
    categoryBreakdown: {
      run: Math.ceil(workoutCount / 2),
      strength: Math.floor(workoutCount / 2),
    },
  };
});

const trainingOverview = {
  currentStats: {
    totalWorkouts: 87,
    avgPerWeek: 6.2,
    totalDuration: 5220,
    avgDuration: 60,
    avgRpe: 4.5,
    avgCompliancePct: 96,
  },
  previousStats: {
    totalWorkouts: 46,
    avgPerWeek: 4.6,
    totalDuration: 2760,
    avgDuration: 60,
    avgRpe: 5.2,
    avgCompliancePct: 82,
  },
  weeklySummaries,
  workoutDates: [
    "2024-01-02",
    "2024-01-04",
    "2024-01-06",
    "2024-01-09",
    "2024-01-11",
    "2024-01-13",
    "2024-01-16",
    "2024-01-18",
    "2024-01-20",
    "2024-02-06",
    "2024-02-08",
    "2024-02-10",
    "2024-02-13",
    "2024-02-15",
    "2024-02-17",
    "2024-03-05",
    "2024-03-07",
    "2024-03-09",
    "2024-03-12",
    "2024-03-14",
  ],
  categoryTotals: {
    run: { count: 42, totalSets: 42 },
    strength: { count: 28, totalSets: 140 },
    functional: { count: 17, totalSets: 85 },
  },
  stationCoverage,
  currentStreak: 6,
  weeklyCompletedWorkouts: 6,
  weeklyGoal: 5,
};

describe("Analytics Page", () => {
  describe("empty state", () => {
    beforeEach(() => {
      setupAuthIntercepts();
      cy.visit("/analytics");
      cy.wait("@authUser");
      cy.wait("@trainingOverview");
    });

    it("shows the analytics page title", () => {
      cy.getBySel("text-analytics-title").should("contain", "Analytics");
    });

    it("shows no personal records message when empty", () => {
      cy.getBySel("tab-prs").click();
      cy.wait("@records");
      cy.getBySel("text-no-prs").should("exist");
    });

    it("shows the category filter", () => {
      cy.getBySel("tab-prs").click();
      cy.wait("@records");
      cy.getBySel("select-pr-category").should("exist");
    });
  });

  describe("with PR data", () => {
    beforeEach(() => {
      setupAuthIntercepts({
        trainingOverview,
        personalRecords: {
          back_squat: {
            customLabel: null,
            category: "strength",
            maxWeight: { value: 100, date: "2024-01-01", workoutLogId: "1" },
          },
          ski_erg: {
            customLabel: null,
            category: "functional",
            bestTime: { value: 180, date: "2024-01-01", workoutLogId: "2" },
            maxDistance: { value: 1000, date: "2024-01-01", workoutLogId: "2" },
          },
        },
        exerciseAnalytics: {
          back_squat: [
            {
              date: "2024-01-01",
              totalVolume: 38400,
              totalReps: 384,
              totalSets: 48,
              maxWeight: 100,
              totalDistance: 0,
            },
          ],
        },
      });
      cy.visit("/analytics");
      cy.wait("@authUser");
      cy.wait("@trainingOverview");
    });

    it("shows PR cards for exercises", () => {
      cy.getBySel("tab-prs").click();
      cy.wait("@records");
      cy.getBySel("card-pr-back_squat").should("exist");
      cy.getBySel("card-pr-ski_erg").should("exist");
    });

    it("displays weight PR value", () => {
      cy.getBySel("tab-prs").click();
      cy.wait("@records");
      cy.getBySel("text-pr-weight-back_squat").should("contain", "100");
    });

    it("shows volume stats section", () => {
      cy.getBySel("tab-trends").click();
      cy.wait("@records");
      cy.wait("@exerciseAnalytics");
      cy.getBySel("select-exercise-progression").click();
      cy.get('[role="option"]').contains("Back Squat").click();
      cy.getBySel("text-total-sessions").should("exist");
      cy.getBySel("text-total-sets").should("exist");
    });

    it("keeps analytics scrolling inside the main app region", () => {
      cy.getBySel("chart-weekly-workouts").should("be.visible");

      cy.get("#main-content").should(($mainContent) => {
        const mainContent = $mainContent[0];
        const styles = getComputedStyle(mainContent);

        expect(styles.overflowY).to.equal("auto");
        expect(styles.overflowX).to.equal("hidden");
        expect(mainContent.scrollHeight).to.be.greaterThan(mainContent.clientHeight);
      });

      cy.window().then((win) => {
        win.scrollTo(0, 400);
        expect(win.scrollY, "window scroll remains locked").to.equal(0);
      });

      cy.get("#main-content")
        .scrollTo("bottom")
        .should(($mainContent) => {
          expect($mainContent[0].scrollTop, "main content scrolls").to.be.greaterThan(0);
        });

      cy.document().then((doc) => {
        // The user-visible invariant is "the document shows no scrollbar".
        // That's determined directly by overflow on documentElement / body —
        // `clip` or `hidden` both produce no scrollbar. Asserting on computed
        // overflow tests the invariant at its source, while the programmatic
        // scroll check above catches any leak back to the document scroller.
        const htmlOverflow = getComputedStyle(doc.documentElement).overflowY;
        const bodyOverflow = getComputedStyle(doc.body).overflowY;
        expect(htmlOverflow, "html overflow-y").to.be.oneOf(["clip", "hidden"]);
        expect(bodyOverflow, "body overflow-y").to.be.oneOf(["clip", "hidden"]);
      });

      cy.window().then((win) => {
        expect(
          win.innerWidth - win.document.documentElement.clientWidth,
          "document scrollbar gutter",
        ).to.equal(0);
      });
    });
  });
});
