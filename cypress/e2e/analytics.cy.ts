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
            category: "strength",
            customLabel: null,
            maxWeight: { value: 100, date: "2024-01-01", workoutLogId: "wl1" },
          },
          ski_erg: {
            category: "hyrox_station",
            customLabel: null,
            maxDistance: { value: 1000, date: "2024-01-01", workoutLogId: "wl2" },
            bestTime: { value: 180, date: "2024-01-01", workoutLogId: "wl2" },
          },
        },
        exerciseAnalytics: {
          back_squat: [
            {
              date: "2024-01-01",
              maxWeight: 100,
              totalVolume: 38400,
              totalSets: 48,
              totalReps: 384,
              totalDistance: 0,
            }
          ]
        },
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

    it("shows volume stats section when viewing progression", () => {
      cy.getBySel("button-view-progression-back_squat").click();
      cy.getBySel("text-total-sessions").should("exist");
      cy.getBySel("text-total-sets").should("exist");
    });
  });
});
