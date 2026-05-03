import type { Request, RequestHandler, Response, Router } from "express";

import { aiBudgetCheck } from "../../middleware/aibudget";
import { aiConsentCheck } from "../../middleware/aiConsent";
import { protectedMutationGuards } from "../../routeGuards";
import { asyncHandler, rateLimiter } from "../../routeUtils";

type AsyncRouteHandler<Req extends Request = Request> = (req: Req, res: Response) => Promise<unknown>;

interface ProtectedRouteOptions {
  readonly auth?: boolean;
  readonly rateLimit?: boolean;
  readonly limiter?: ReturnType<typeof rateLimiter>;
  readonly aiConsent?: boolean;
  readonly aiBudget?: boolean;
  readonly validation?: RequestHandler[];
  readonly middleware?: RequestHandler[];
}

function buildProtectedStack<Req extends Request>(
  options: ProtectedRouteOptions,
  handler: AsyncRouteHandler<Req> | RequestHandler,
): RequestHandler[] {
  const stack: RequestHandler[] = [];

  if (options.auth ?? true) {
    stack.push(...protectedMutationGuards);
  }

  if (options.rateLimit ?? true) {
    if (!options.limiter) {
      throw new Error("Protected routes with rate limiting enabled require a limiter");
    }
    stack.push(options.limiter);
  }

  if (options.aiConsent) stack.push(aiConsentCheck);
  if (options.aiBudget) stack.push(aiBudgetCheck);

  stack.push(...(options.validation ?? []), ...(options.middleware ?? []));

  if (handler.length >= 3) {
    stack.push(handler as RequestHandler);
  } else {
    stack.push(asyncHandler(handler as AsyncRouteHandler<Req>));
  }

  return stack;
}

export function protectedPost<Req extends Request = Request>(router: Router, path: string, options: ProtectedRouteOptions, handler: AsyncRouteHandler<Req> | RequestHandler): void {
  router.post(path, ...buildProtectedStack(options, handler));
}

export function protectedPatch<Req extends Request = Request>(router: Router, path: string, options: ProtectedRouteOptions, handler: AsyncRouteHandler<Req> | RequestHandler): void {
  router.patch(path, ...buildProtectedStack(options, handler));
}

export function protectedDelete<Req extends Request = Request>(router: Router, path: string, options: ProtectedRouteOptions, handler: AsyncRouteHandler<Req> | RequestHandler): void {
  router.delete(path, ...buildProtectedStack(options, handler));
}

export const __private__ = { buildProtectedStack };
