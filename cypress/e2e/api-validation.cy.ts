describe("API Validation", () => {
  const protectedEndpoints = [
    { method: "GET", url: "/api/v1/workouts" },
    { method: "POST", url: "/api/v1/workouts" },
    { method: "GET", url: "/api/v1/plans" },
    { method: "POST", url: "/api/v1/plans/import" },
    { method: "POST", url: "/api/v1/chat" },
    { method: "GET", url: "/api/v1/export" },
    { method: "PATCH", url: "/api/v1/preferences" },
    { method: "DELETE", url: "/api/v1/strava/disconnect" },
    { method: "GET", url: "/api/v1/personal-records" },
    { method: "GET", url: "/api/v1/exercise-analytics" },
    { method: "GET", url: "/api/v1/custom-exercises" },
    { method: "POST", url: "/api/v1/parse-exercises" },
    { method: "GET", url: "/api/v1/timeline" },
  ];

  protectedEndpoints.forEach(({ method, url }) => {
    it(`${method} ${url} returns 401 without auth`, () => {
      cy.request({
        method,
        url,
        failOnStatusCode: false,
        body: method === "POST" || method === "PATCH" ? {} : undefined,
      }).then((response) => {
        expect(response.status).to.eq(401);
      });
    });
  });

  it("GET /api/cron/emails returns 401 without secret", () => {
    cy.request({ url: "/api/v1/cron/emails", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });

  it("GET /api/cron/emails returns 401 with wrong secret", () => {
    cy.request({
      url: "/api/v1/cron/emails?secret=wrong-secret",
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });
});
