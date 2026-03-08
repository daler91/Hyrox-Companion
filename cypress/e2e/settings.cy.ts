import { setupAuthIntercepts } from "../support/authIntercepts";

describe("Settings Page", () => {
  describe("default state", () => {
    beforeEach(() => {
      setupAuthIntercepts();
      cy.visit("/settings");
      cy.wait("@authUser");
      cy.wait("@preferences");
      cy.wait("@stravaStatus");
    });

    it("displays the user display name", () => {
      cy.getBySel("text-display-name").should("contain", "Test Athlete");
    });

    it("shows weight unit selector with default value", () => {
      cy.getBySel("select-weight-unit").should("exist");
    });

    it("shows distance unit selector with default value", () => {
      cy.getBySel("select-distance-unit").should("exist");
    });

    it("shows weekly goal selector", () => {
      cy.getBySel("select-weekly-goal").should("exist");
    });

    it("shows email notifications toggle", () => {
      cy.getBySel("switch-email-notifications").should("exist");
    });

    it("shows export data buttons", () => {
      cy.getBySel("button-export-csv").should("exist");
      cy.getBySel("button-export-json").should("exist");
    });

    it("shows structure old workouts section", () => {
      cy.getBySel("button-find-unstructured").should("exist");
    });

    it("shows save button disabled when no changes", () => {
      cy.getBySel("button-save-settings").should("be.disabled");
    });
  });

  describe("Strava disconnected", () => {
    beforeEach(() => {
      setupAuthIntercepts({ stravaStatus: { connected: false } });
      cy.visit("/settings");
      cy.wait("@authUser");
      cy.wait("@preferences");
      cy.wait("@stravaStatus");
    });

    it("shows connect Strava button when not connected", () => {
      cy.getBySel("button-connect-strava").should("exist");
    });
  });

  describe("Strava connected", () => {
    beforeEach(() => {
      setupAuthIntercepts({
        stravaStatus: {
          connected: true,
          athleteId: "12345",
          lastSyncedAt: new Date().toISOString(),
        },
      });
      cy.visit("/settings");
      cy.wait("@authUser");
      cy.wait("@preferences");
      cy.wait("@stravaStatus");
    });

    it("shows sync and disconnect buttons when Strava is connected", () => {
      cy.getBySel("button-sync-strava").should("exist");
      cy.getBySel("button-disconnect-strava").should("exist");
    });
  });
});
