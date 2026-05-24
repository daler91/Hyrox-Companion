import { setupAuthIntercepts } from "../support/authIntercepts";

function visitSettings(options?: Parameters<typeof setupAuthIntercepts>[0]) {
  setupAuthIntercepts(options);
  cy.visit("/settings");
  cy.wait("@authUser");
  cy.wait("@preferences");
  cy.wait("@stravaStatus");
}

describe("Settings Page", () => {
  describe("default state", () => {
    beforeEach(() => {
      visitSettings();
    });

    it("displays the user display name", () => {
      cy.getBySel("text-display-name").should("contain", "Test Athlete");
    });

    for (const selector of [
      "select-weight-unit",
      "select-distance-unit",
      "select-weekly-goal",
      "switch-email-notifications",
      "button-export-csv",
      "button-export-json",
      "button-find-unstructured",
    ]) {
      it(`shows ${selector}`, () => {
        cy.getBySel(selector).should("exist");
      });
    }

    it("hides save button when no changes", () => {
      cy.getBySel("button-save-settings").should("not.exist");
    });
  });

  describe("Strava disconnected", () => {
    beforeEach(() => {
      visitSettings({ stravaStatus: { connected: false } });
    });

    it("shows connect Strava button when not connected", () => {
      cy.getBySel("button-connect-strava").should("exist");
    });
  });

  describe("Strava connected", () => {
    beforeEach(() => {
      visitSettings({
        stravaStatus: {
          connected: true,
          athleteId: "12345",
          lastSyncedAt: new Date().toISOString(),
        },
      });
    });

    it("shows sync and disconnect buttons when Strava is connected", () => {
      cy.getBySel("button-sync-strava").should("exist");
      cy.getBySel("button-disconnect-strava").should("exist");
    });
  });
});
