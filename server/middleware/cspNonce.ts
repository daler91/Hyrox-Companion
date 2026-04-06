import { randomBytes } from "node:crypto";

import type { NextFunction,Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required for Express type augmentation
  namespace Express {
    interface Locals {
      cspNonce: string;
    }
  }
}

/**
 * Generates a per-request cryptographic nonce for CSP script-src.
 * 128 bits of entropy, base64-encoded.
 */
export function cspNonceMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.locals.cspNonce = randomBytes(16).toString("base64");
  next();
}
