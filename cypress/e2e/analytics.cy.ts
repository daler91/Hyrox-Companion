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
          back_squat: {
            customLabel: null,
            category: "strength",
            maxWeight: { value: 100, date: "2024-01-01", workoutLogId: "1" },
          },
          ski_erg: {
            customLabel: null,
            category: "hyrox_station",
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
      cy.wait("@records");
      cy.wait("@exerciseAnalytics");
    });

    it("shows PR cards for exercises", () => {
      cy.getBySel("tab-prs").click();
      cy.getBySel("card-pr-back_squat").should("exist");
      cy.getBySel("card-pr-ski_erg").should("exist");
    });

    it("displays weight PR value", () => {
      cy.getBySel("tab-prs").click();
      cy.getBySel("text-pr-weight-back_squat").should("contain", "100");
    });

    it("shows volume stats section", () => {
      cy.getBySel("tab-trends").click();
      cy.getBySel("select-exercise-progression").click();
      cy.get('[role="option"]').contains("Back Squat").click();
      cy.getBySel("text-total-sessions").should("exist");
      cy.getBySel("text-total-sets").should("exist");
    });
  });
});
