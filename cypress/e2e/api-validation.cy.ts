describe("API Validation", () => {
  const protectedEndpoints = [
    { method: "GET", url: "/api/workouts" },
    { method: "POST", url: "/api/workouts" },
    { method: "GET", url: "/api/plans" },
    { method: "POST", url: "/api/plans/import" },
    { method: "POST", url: "/api/chat" },
    { method: "GET", url: "/api/export" },
    { method: "PATCH", url: "/api/preferences" },
    { method: "DELETE", url: "/api/strava/disconnect" },
    { method: "GET", url: "/api/personal-records" },
    { method: "GET", url: "/api/exercise-analytics" },
    { method: "GET", url: "/api/custom-exercises" },
    { method: "POST", url: "/api/parse-exercises" },
    { method: "GET", url: "/api/timeline" },
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
    cy.request({ url: "/api/cron/emails", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });

  it("GET /api/cron/emails returns 401 with wrong secret", () => {
    cy.request({
      url: "/api/cron/emails?secret=wrong-secret",
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(401);
    });
  });
});
