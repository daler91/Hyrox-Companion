describe("Landing Page", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("renders the hero section with heading and CTAs", () => {
    cy.get("h1").should("be.visible");
    cy.getBySel("button-get-started").should("be.visible");
    cy.getBySel("button-start-training").should("be.visible");
  });

  it("shows the login button in the header", () => {
    cy.getBySel("button-login-header").should("be.visible");
  });

  it("has the correct page title", () => {
    cy.title().should("not.be.empty");
  });

  it("has Open Graph meta tags", () => {
    cy.get('meta[property="og:title"]').should("have.attr", "content");
    cy.get('meta[property="og:description"]').should("have.attr", "content");
  });

  it("returns security headers on the response", () => {
    cy.request("/").then((response) => {
      expect(response.headers).to.have.property("x-frame-options", "SAMEORIGIN");
      expect(response.headers).to.have.property("x-content-type-options", "nosniff");
      expect(response.headers).to.have.property("referrer-policy", "strict-origin-when-cross-origin");
      expect(response.headers).to.have.property("permissions-policy");
      expect(response.headers).to.have.property("content-security-policy");
    });
  });
});
