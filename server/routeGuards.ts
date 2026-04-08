import type { RequestHandler } from "express";

import { isAuthenticated } from "./clerkAuth";
import { idempotencyMiddleware } from "./middleware/idempotency";

// Compose auth + idempotency for mutating endpoints (POST/PUT/PATCH/DELETE).
// Idempotency must run AFTER auth so getUserId(req) is available.
export const protectedMutationGuards: RequestHandler[] = [
  isAuthenticated,
  (req, res, next) => {
    void idempotencyMiddleware(req, res, next);
  },
];
