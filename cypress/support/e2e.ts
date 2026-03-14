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
});
