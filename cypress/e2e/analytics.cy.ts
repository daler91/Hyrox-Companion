import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Analytics Page", () => {
  describe("empty state", () => {
    beforeEach(() => {
      setupAuthIntercepts();
      cy.visit("/analytics");
      cy.wait("@authUser");
      cy.wait("@records");
      cy.wait("@exerciseAnalytics");
    });

    it("shows the analytics page title", () => {
      cy.getBySel("text-analytics-title").should("contain", "Analytics");
    });

    it("shows no personal records message when empty", () => {
      cy.getBySel("text-no-prs").should("exist");
    });

    it("shows the category filter", () => {
      cy.getBySel("select-pr-category").should("exist");
    });
  });

  describe("with PR data", () => {
    beforeEach(() => {
      setupAuthIntercepts({
        personalRecords: {
          "back_squat": {
            exerciseName: "back_squat",
            customLabel: null,
            category: "strength",
            maxWeight: { value: 100, date: "2023-01-01" },
            bestTime: null,
            maxDistance: null,
            totalSessions: 12,
            totalSets: 48,
            totalReps: 384,
          },
          "ski_erg": {
            exerciseName: "ski_erg",
            customLabel: null,
            category: "hyrox_station",
            maxWeight: null,
            bestTime: { value: 180, date: "2023-01-01" },
            maxDistance: { value: 1000, date: "2023-01-01" },
            totalSessions: 8,
            totalSets: 16,
            totalReps: null,
          },
        } as any,
        exerciseAnalytics: {
          "back_squat": [
            {
              date: "2023-01-01",
              exerciseName: "back_squat",
              customLabel: null,
              category: "strength",
              totalVolume: 38400,
              totalSets: 48,
              totalReps: 384,
              maxWeight: 100,
              totalDistance: 0,
              sessionCount: 12,
            },
          ]
        } as any,
      });
      cy.visit("/analytics");
      cy.wait("@authUser");
      cy.wait("@records");
      cy.wait("@exerciseAnalytics");
    });

    it("shows PR cards for exercises", () => {
      cy.getBySel("card-pr-back_squat").should("exist");
      cy.getBySel("card-pr-ski_erg").should("exist");
    });

    it("displays weight PR value", () => {
      cy.getBySel("text-pr-weight-back_squat").should("contain", "100");
    });

    it("shows volume stats section", () => {
      cy.getBySel("button-view-progression-back_squat").click();
      cy.getBySel("text-total-sessions").should("exist");
      cy.getBySel("text-total-sets").should("exist");
    });
  });
});
