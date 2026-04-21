import "./commands";

Cypress.on('uncaught:exception', (err, runnable) => {
  if (/\bclerk\.example\.com\b/.test(err.message)) {
    return false;
  }
  return true;
});

// Pre-dismiss the privacy consent banner so it cannot overlay interactive
// UI at the bottom of the viewport during Cypress runs. Real users see the
// banner on first load, click dismiss, and never again.
//
// Registered at module scope via `Cypress.on` (not `cy.on` inside beforeEach)
// because the per-test listener races the `cy.visit()` in specs' beforeEach
// hooks — it sometimes misses the window:before:load event, the banner
// renders, and its fixed `z-[60]` overlay covers the save button at the
// bottom of the viewport, causing false-positive "element is covered" click
// failures. A global listener attaches once and fires reliably for every visit.
Cypress.on('window:before:load', (win) => {
  win.localStorage.setItem('hyrox-privacy-consent-v1', String(Date.now()));
});

beforeEach(() => {
  cy.intercept('https://clerk.example.com/**', {
    statusCode: 200,
    body: {}
  });
});
