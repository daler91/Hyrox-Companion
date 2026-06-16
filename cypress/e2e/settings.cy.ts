import { setupAuthIntercepts } from "../support/authIntercepts";

type SettingsTab = "account" | "training" | "integrations" | "notifications" | "data";

// Settings is split into deep-linkable tabs (`?tab=`), and Radix unmounts the
// inactive panels, so each assertion visits the tab that owns its control.
function visitSettings(
  tab?: SettingsTab,
  options?: Parameters<typeof setupAuthIntercepts>[0],
) {
  setupAuthIntercepts(options);
  cy.visit(tab ? `/settings?tab=${tab}` : "/settings");
  cy.wait("@authUser");
  cy.wait("@preferences");
  cy.wait("@stravaStatus");
}

describe("Settings Page", () => {
  describe("default state", () => {
    it("displays the user display name", () => {
      visitSettings("account");
      cy.getBySel("text-display-name").should("contain", "Test Athlete");
    });

    const tabSelectors: Array<[string, SettingsTab]> = [
      ["select-weight-unit", "account"],
      ["select-distance-unit", "account"],
      ["select-weekly-goal", "training"],
      ["switch-email-notifications", "notifications"],
      ["button-export-csv", "data"],
      ["button-export-json", "data"],
      ["button-find-unstructured", "data"],
    ];

    for (const [selector, tab] of tabSelectors) {
      it(`shows ${selector} on the ${tab} tab`, () => {
        visitSettings(tab);
        cy.getBySel(selector).should("exist");
      });
    }

    it("hides save button when no changes", () => {
      visitSettings();
      cy.getBySel("button-save-settings").should("not.exist");
    });
  });

  describe("Strava disconnected", () => {
    it("shows connect Strava button when not connected", () => {
      visitSettings("integrations", { stravaStatus: { connected: false } });
      cy.getBySel("button-connect-strava").should("exist");
    });
  });

  describe("Strava connected", () => {
    it("shows sync and disconnect buttons when Strava is connected", () => {
      visitSettings("integrations", {
        stravaStatus: {
          connected: true,
          athleteId: "12345",
          lastSyncedAt: new Date().toISOString(),
        },
      });
      cy.getBySel("button-sync-strava").should("exist");
      cy.getBySel("button-disconnect-strava").should("exist");
    });
  });
});
