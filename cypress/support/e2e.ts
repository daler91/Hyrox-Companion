import "./commands";

Cypress.on('uncaught:exception', (err, runnable) => {
  if (err.message.includes('clerk.example.com')) {
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
