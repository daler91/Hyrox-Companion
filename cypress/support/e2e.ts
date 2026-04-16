import "./commands";

Cypress.on('uncaught:exception', (err, runnable) => {
  if (/\bclerk\.example\.com\b/.test(err.message)) {
    return false;
  }
  return true;
});

beforeEach(() => {
  cy.intercept('https://clerk.example.com/**', {
    statusCode: 200,
    body: {}
  });

  // Pre-dismiss the privacy consent banner so it cannot overlay interactive
  // UI at the bottom of the viewport during Cypress runs. Real users see the
  // banner on first load, click dismiss, and never again.
  cy.on('window:before:load', (win) => {
    win.localStorage.setItem('hyrox-privacy-consent-v1', String(Date.now()));
  });
});
