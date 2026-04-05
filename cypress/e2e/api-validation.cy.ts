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
    { method: "GET", url: "/api/v1/auth/user" },
  ];

  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  // For mutating endpoints the CSRF middleware runs before auth, so we must
  // present a valid token; otherwise we'd get a 403 before the 401 the test
  // is actually verifying. Fetch it once per spec run.
  let csrfToken: string | null = null;
  before(() => {
    cy.request({ url: "/api/v1/csrf-token" }).then((res) => {
      csrfToken = (res.body as { csrfToken: string }).csrfToken;
    });
  });

  protectedEndpoints.forEach(({ method, url }) => {
    it(`${method} ${url} returns 401 without auth`, () => {
      const headers: Record<string, string> = {
        "x-test-no-bypass": "true",
      };
      if (MUTATING.has(method) && csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }
      cy.request({
        method,
        url,
        failOnStatusCode: false,
        headers,
        body: method === "POST" || method === "PATCH" ? {} : undefined,
      }).then((response) => {
        if (url === "/api/v1/auth/user" && method === "GET") {
          expect(response.status).to.be.oneOf([200, 401]);
          if (response.status === 200) {
            expect(response.body).to.be.null;
          }
        } else {
          expect(response.status).to.eq(401);
        }
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
