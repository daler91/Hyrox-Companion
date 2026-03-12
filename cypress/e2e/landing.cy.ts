describe("Landing Page", () => {
  it("returns security headers on the response", () => {
    cy.request("/").then((response) => {
      expect(response.headers).to.have.property("x-frame-options", "SAMEORIGIN");
      expect(response.headers).to.have.property("x-content-type-options", "nosniff");
      expect(response.headers).to.have.property("referrer-policy", "strict-origin-when-cross-origin");
      expect(response.headers).to.have.property("permissions-policy");
      expect(response.headers).to.have.property("content-security-policy");
    });
  });

  it("has the correct page title", () => {
    cy.visit("/");
    cy.title().should("not.be.empty");
  });

  it("has Open Graph meta tags", () => {
    cy.visit("/");
    cy.get('meta[property="og:title"]').should("have.attr", "content");
    cy.get('meta[property="og:description"]').should("have.attr", "content");
  });
});
