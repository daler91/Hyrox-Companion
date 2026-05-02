import type { Request, RequestHandler, Response, Router } from "express";

import { protectedMutationGuards } from "../../routeGuards";
import { asyncHandler, rateLimiter } from "../../routeUtils";

type AsyncRouteHandler<Req extends Request = Request> = (req: Req, res: Response) => Promise<unknown>;

interface ProtectedRouteOptions {
  readonly limiter: ReturnType<typeof rateLimiter>;
  readonly middleware?: RequestHandler[];
}

function buildProtectedStack<Req extends Request>(
  options: ProtectedRouteOptions,
  handler: AsyncRouteHandler<Req> | RequestHandler,
): RequestHandler[] {
  const stack: RequestHandler[] = [
    ...protectedMutationGuards,
    options.limiter,
    ...(options.middleware ?? []),
  ];

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
