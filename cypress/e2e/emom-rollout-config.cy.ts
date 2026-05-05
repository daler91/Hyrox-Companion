describe("EMOM rollout config", () => {
  it("fails rollout envs when EMOM flag is disabled", () => {
    const isRolloutEnv = Cypress.env("EMOM_ROLLOUT_ENV") === true || Cypress.env("EMOM_ROLLOUT_ENV") === "true";
    if (!isRolloutEnv) return;

    const raw = Cypress.env("VITE_EMOM_BUILDER_ENABLED");
    const enabled = raw === true || raw === "true" || raw === "1";

    expect(enabled, "VITE_EMOM_BUILDER_ENABLED must be true in rollout environments").to.eq(true);
  });

  it("shows diagnostics badge in non-production with active editor mode", () => {
    cy.visit("/log");
    cy.get('[data-testid="badge-editor-mode-diagnostics"]').should("be.visible");
    cy.get('[data-testid="badge-editor-mode-diagnostics"]').invoke("text").should("match", /Editor mode: (structured-emom|legacy-text)/);
  });
});
