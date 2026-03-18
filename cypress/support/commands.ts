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

// Ensure the file is treated as an ES module by TypeScript
// to support global augmentation above without triggering the
// 'typescript:S1186' SonarCloud rule for empty exports.
export const _ = undefined;
