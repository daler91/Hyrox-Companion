import { defineConfig } from "cypress";

export default defineConfig({
  projectId: "dy8p9y",
  e2e: {
    baseUrl: "http://localhost:5000",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    video: true,
    screenshotOnRunFailure: true,
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
  },
});
