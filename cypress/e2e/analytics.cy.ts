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

const movementPatternCoverage = ([
  ["squat", "Squat pattern", 8, 40, "2024-03-10", 5],
  ["hinge", "Hinge pattern", 6, 30, "2024-03-08", 7],
  ["horizontal_push", "Horizontal push", 5, 24, "2024-03-06", 9],
  ["vertical_push", "Vertical push", 4, 18, "2024-03-02", 13],
  ["horizontal_pull", "Horizontal pull", 7, 32, "2024-03-12", 3],
  ["vertical_pull", "Vertical pull", 3, 14, "2024-02-28", 16],
  ["lunge_split_squat", "Lunge / split squat", 4, 20, "2024-03-04", 11],
  ["carry", "Carry", 2, 10, "2024-02-20", 24],
  ["core_flexion", "Core flexion", 5, 25, "2024-03-01", 14],
  ["core_anti_rotation", "Core anti-rotation", 3, 12, "2024-02-26", 18],
] as const).map(([pattern, label, sessionCount, totalSets, lastTrained, daysSince]) => ({
  pattern,
  label,
  sessionCount,
  totalSets,
  lastTrained,
  daysSince,
}));

const muscleGroupCoverage = ([
  ["chest", "Chest", "upper", 7, 34, "2024-03-10", 5],
  ["shoulders", "Shoulders", "upper", 6, 28, "2024-03-10", 5],
  ["rear_delts", "Rear delts", "upper", 3, 12, "2024-03-06", 9],
  ["traps", "Traps", "upper", 2, 8, "2024-03-02", 13],
  ["lats", "Lats", "upper", 8, 36, "2024-03-12", 3],
  ["upper_back", "Upper back", "upper", 8, 36, "2024-03-12", 3],
  ["biceps", "Biceps", "upper", 4, 18, "2024-03-04", 11],
  ["triceps", "Triceps", "upper", 5, 20, "2024-03-10", 5],
  ["forearms", "Forearms", "upper", 2, 10, "2024-02-20", 24],
  ["core", "Core", "core", 9, 42, "2024-03-12", 3],
  ["obliques", "Obliques", "core", 3, 12, "2024-03-01", 14],
  ["lower_back", "Lower back", "core", 5, 21, "2024-03-08", 7],
  ["hip_flexors", "Hip flexors", "lower", 3, 14, "2024-03-01", 14],
  ["quads", "Quads", "lower", 10, 52, "2024-03-14", 1],
  ["hamstrings", "Hamstrings", "lower", 8, 37, "2024-03-12", 3],
  ["glutes", "Glutes", "lower", 9, 45, "2024-03-12", 3],
  ["adductors", "Adductors", "lower", 2, 8, "2024-02-28", 16],
  ["hip_abductors", "Hip abductors", "lower", 2, 8, "2024-02-28", 16],
  ["calves", "Calves", "lower", 7, 30, "2024-03-14", 1],
  ["tibialis", "Tibialis", "lower", 1, 4, "2024-02-20", 24],
] as const).map(([muscle, label, bodyRegion, sessionCount, totalSets, lastTrained, daysSince]) => ({
  muscle,
  label,
  bodyRegion,
  sessionCount,
  totalSets,
  lastTrained,
  daysSince,
}));

const scrollMainContentToTestId = (selector: string) => {
  cy.getBySel(selector).then(($element) => {
    cy.get("#main-content").then(($mainContent) => {
      const mainContent = $mainContent[0];
      const elementRect = $element[0].getBoundingClientRect();
      const mainRect = mainContent.getBoundingClientRect();
      mainContent.scrollTop = Math.max(0, mainContent.scrollTop + elementRect.top - mainRect.top - 24);
    });
  });
};

const expectInMainContentViewport = (selector: string) => {
  cy.get("#main-content").then(($mainContent) => {
    const mainRect = $mainContent[0].getBoundingClientRect();

    cy.getBySel(selector).should(($element) => {
      const elementRect = $element[0].getBoundingClientRect();
      const styles = getComputedStyle($element[0]);

      expect(styles.display, `${selector} display`).to.not.equal("none");
      expect(styles.visibility, `${selector} visibility`).to.not.equal("hidden");
      expect(elementRect.width, `${selector} width`).to.be.greaterThan(0);
      expect(elementRect.height, `${selector} height`).to.be.greaterThan(0);
      expect(elementRect.bottom, `${selector} bottom`).to.be.greaterThan(mainRect.top);
      expect(elementRect.top, `${selector} top`).to.be.lessThan(mainRect.bottom);
    });
  });
};

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
const avgRpes = [5.5, 5.7, 6.1, 6.2, 5.6, 6.8, 6, 6.4, 7, 6.7, 7.2, 6.3];

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
  movementPatternCoverage,
  muscleGroupCoverage,
  currentStreak: 6,
  weeklyCompletedWorkouts: 6,
  weeklyGoal: 5,
  trainingLoad: {
    currentUtss: 82,
    acuteAvg: 78,
    chronicAvg: 70,
    acwr: 1.11,
    zone: "sweet_spot",
    flaggedVectors: [],
    activeRestrictions: [],
    downshiftRationale: null,
    trend: weekStarts.map((date, index) => ({
      date,
      utss: 60 + index * 2,
      acwr: 0.95 + index * 0.02,
      zone: "sweet_spot",
    })),
  },
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

    it("renders the muscle heat map across desktop and mobile widths", () => {
      cy.getBySel("tab-breakdown").click();
      scrollMainContentToTestId("muscle-heat-map-card");
      cy.getBySel("muscle-heat-map-card").should("exist");
      expectInMainContentViewport("muscle-heat-map-card");
      scrollMainContentToTestId("muscle-heat-map-silhouette");
      cy.getBySel("muscle-heat-map-silhouette").should("exist");
      expectInMainContentViewport("muscle-heat-map-silhouette");
      cy.getBySel("muscle-tile-quads").should("contain", "52 sets");
      cy.getBySel("muscle-tile-quads").should("contain", "Peak set volume");

      cy.viewport(390, 844);
      scrollMainContentToTestId("muscle-heat-map-card");
      cy.getBySel("muscle-heat-map-card").should("exist");
      expectInMainContentViewport("muscle-heat-map-card");
      scrollMainContentToTestId("muscle-heat-map-silhouette");
      cy.getBySel("muscle-heat-map-silhouette").should("exist");
      expectInMainContentViewport("muscle-heat-map-silhouette");
      scrollMainContentToTestId("muscle-tile-quads");
      cy.getBySel("muscle-tile-quads").should("exist");
      expectInMainContentViewport("muscle-tile-quads");
    });

    it("keeps analytics scrolling inside the main app region", () => {
      cy.getBySel("text-avg-workouts").should("be.visible");
      cy.getBySel("chart-weekly-workouts").should("exist");

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
