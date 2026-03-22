import express from "express";

/**
 * Creates a mocked express error handler to accurately verify that
 * asyncHandler bubbles errors correctly via next(err) without breaking tests.
 */
export function setupTestErrorHandler(app: express.Express) {
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Intentionally left with only status sending logic to mock error handler behavior
    res.status(err.status || 500).json({ error: "Internal Server Error" });
  });
}
