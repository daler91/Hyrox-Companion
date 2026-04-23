Cypress.Commands.add("getBySel", (selector: string) => {
  return cy.get(`[data-testid="${selector}"]`);
});

// The global `Cypress.on('window:before:load')` hook in support/e2e.ts
// sets the consent key before the SPA boots — but its own comment notes
// the hook occasionally races SPA navigation, which lets the banner
// render and overlay bottom-of-viewport interactive elements. Specs
// that interact with the sticky save button can re-assert the key on
// the live window after `cy.visit(...)` — PrivacyConsentBanner now
// listens for the custom `fitai:privacy-consent-changed` event and
// re-reads storage, so dispatching here forces the banner to self-hide
// even if it already mounted with the key absent.
Cypress.Commands.add("ensureConsentDismissed", () => {
  cy.window({ log: false }).then((win) => {
    if (win.localStorage.getItem("fitai-privacy-consent-v1") === null) {
      win.localStorage.setItem("fitai-privacy-consent-v1", String(Date.now()));
    }
    win.dispatchEvent(new Event("fitai:privacy-consent-changed"));
  });
});

declare global {
  namespace Cypress {
    interface Chainable {
      getBySel(selector: string): Chainable<JQuery<HTMLElement>>;
      ensureConsentDismissed(): Chainable<void>;
    }
  }
}

export default {};
