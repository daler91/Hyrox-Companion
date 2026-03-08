Cypress.Commands.add("getBySel", (selector: string) => {
  return cy.get(`[data-testid="${selector}"]`);
});

declare global {
  namespace Cypress {
    interface Chainable {
      getBySel(selector: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}

export {};
