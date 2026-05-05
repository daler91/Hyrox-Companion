describe("EMOM rollout config", () => {
  it("fails rollout envs when EMOM flag is disabled", () => {
    const isRolloutEnv = cy.env("EMOM_ROLLOUT_ENV") === true || cy.env("EMOM_ROLLOUT_ENV") === "true";
    if (!isRolloutEnv) return;

    const raw = cy.env("VITE_EMOM_BUILDER_ENABLED");
    const enabled = raw === true || raw === "true" || raw === "1";

    expect(enabled, "VITE_EMOM_BUILDER_ENABLED must be true in rollout environments").to.eq(true);
  });

  it("shows diagnostics badge in non-production with active editor mode", () => {
    cy.visit("/log");

    const expectBadge = cy.env("EXPECT_EDITOR_DIAGNOSTICS_BADGE") === true || cy.env("EXPECT_EDITOR_DIAGNOSTICS_BADGE") === "true";

    if (!expectBadge) {
      cy.get('[data-testid="badge-editor-mode-diagnostics"]').should("not.exist");
      return;
    }

    cy.get('[data-testid="badge-editor-mode-diagnostics"]').should("be.visible");
    cy.get('[data-testid="badge-editor-mode-diagnostics"]').invoke("text").should("match", /Editor mode: (structured-emom|legacy-text)/);
  });
});
