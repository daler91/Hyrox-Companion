Cypress.Commands.add("getBySel", (selector: string) => {
  return cy.get(`[data-testid="${selector}"]`);
});

// The global `Cypress.on('window:before:load')` hook in support/e2e.ts
// sets the consent key before the SPA boots — but its own comment notes
// the hook occasionally races SPA navigation, which lets the banner
// render and overlay bottom-of-viewport interactive elements. Specs
// that interact with the sticky save button can re-assert the key on
// the live window after `cy.visit(...)` so the banner's `useState`
// initialiser sees a non-null consent timestamp on next render.
Cypress.Commands.add("ensureConsentDismissed", () => {
  cy.window({ log: false }).then((win) => {
    if (win.localStorage.getItem("fitai-privacy-consent-v1") === null) {
      win.localStorage.setItem("fitai-privacy-consent-v1", String(Date.now()));
    }
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
