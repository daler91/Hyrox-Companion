const fs = require('fs');

const file = 'server/routes/__tests__/analytics.test.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('clearRateLimitBuckets')) {
  code = code.replace(
    /describe\("Analytics Routes", \(\) => \{/,
    'import { clearRateLimitBuckets } from "../../routeUtils";\n\ndescribe("Analytics Routes", () => {'
  );

  code = code.replace(
    /beforeEach\(\(\) => \{/,
    'beforeEach(() => {\n    clearRateLimitBuckets();'
  );
}

// Ensure the describe block structure is correct to add rate limit tests
const rateLimitTest1 = `
    it("should be rate limited after too many requests", async () => {
      // Setup successful response
      vi.mocked(storage.getAllExerciseSetsWithDates).mockResolvedValue([]);

      // Make 20 successful requests (the limit)
      for (let i = 0; i < 20; i++) {
        await request(app).get(PRS_ENDPOINT);
      }

      // The 21st request should be rate limited
      const rateLimitedResponse = await request(app).get(PRS_ENDPOINT);
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body.error).toContain("Too many requests");
    });
`;

const rateLimitTest2 = `
    it("should be rate limited after too many requests", async () => {
      // Setup successful response
      vi.mocked(storage.getAllExerciseSetsWithDates).mockResolvedValue([]);

      // Make 20 successful requests (the limit)
      for (let i = 0; i < 20; i++) {
        await request(app).get(EXERCISE_ANALYTICS_ENDPOINT);
      }

      // The 21st request should be rate limited
      const rateLimitedResponse = await request(app).get(EXERCISE_ANALYTICS_ENDPOINT);
      expect(rateLimitedResponse.status).toBe(429);
      expect(rateLimitedResponse.body.error).toContain("Too many requests");
    });
`;

if (!code.includes('should be rate limited after too many requests')) {
  // Add to PRs tests
  code = code.replace(
    /describe\("GET \/api\/v1\/personal-records", \(\) => \{/,
    `describe("GET /api/v1/personal-records", () => {${rateLimitTest1}`
  );

  // Add to Exercise analytics tests
  code = code.replace(
    /describe\("GET \/api\/v1\/exercise-analytics", \(\) => \{/,
    `describe("GET /api/v1/exercise-analytics", () => {${rateLimitTest2}`
  );
}

fs.writeFileSync(file, code);
console.log('patched test');
