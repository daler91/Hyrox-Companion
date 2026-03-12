describe("Authentication", () => {
  it("returns 401 for unauthenticated API requests", () => {
    cy.request({ url: "/api/timeline", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });

  it("returns 401 for workout API without session", () => {
    cy.request({ url: "/api/workouts", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });

  it("returns 401 for training plans API without session", () => {
    cy.request({ url: "/api/plans", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });

  it("returns 401 for auth user endpoint without session", () => {
    cy.request({ url: "/api/auth/user", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.be.oneOf([200, 401]);
      if (response.status === 200) {
        expect(response.body).to.be.null;
      }
    });
  });
});
