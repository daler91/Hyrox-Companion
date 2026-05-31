import type { Request, Response } from 'express';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import { aiBudgetCheck } from '../../middleware/aibudget';
import { aiConsentCheck } from '../../middleware/aiConsent';
import { protectedMutationGuards } from '../../routeGuards';
import { asyncHandler } from '../../routeUtils';
import { __private__,protectedDelete, protectedPatch, protectedPost } from './protectedRouteBuilder';

vi.mock('../../middleware/aibudget', () => ({ aiBudgetCheck: vi.fn() }));
vi.mock('../../middleware/aiConsent', () => ({ aiConsentCheck: vi.fn() }));
vi.mock('../../routeGuards', () => ({ protectedMutationGuards: [vi.fn(), vi.fn()] }));
vi.mock('../../routeUtils', () => ({
  asyncHandler: vi.fn((fn) => fn),
  rateLimiter: vi.fn()
}));

describe('protectedRouteBuilder', () => {
  const mockLimiter = vi.fn() as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildProtectedStack', () => {
    it('throws error if auth is false but aiConsent is true', () => {
      expect(() => {
        __private__.buildProtectedStack({ auth: false, aiConsent: true, rateLimit: false } as any, vi.fn());
      }).toThrowError('AI guard middleware requires auth to be enabled');
    });

    it('throws error if auth is false but aiBudget is true', () => {
      expect(() => {
        __private__.buildProtectedStack({ auth: false, aiBudget: true, rateLimit: false } as any, vi.fn());
      }).toThrowError('AI guard middleware requires auth to be enabled');
    });

    it('builds stack with default auth (true) and protectedMutationGuards', () => {
      const handler = async (req: Request, res: Response) => {};
      const stack = __private__.buildProtectedStack({ rateLimit: false }, handler);

      expect(stack).toContain(protectedMutationGuards[0]);
      expect(stack).toContain(protectedMutationGuards[1]);
      expect(asyncHandler).toHaveBeenCalledWith(handler);
      expect(stack).toContain(handler); // since asyncHandler returns the function in our mock
    });

    it('excludes protectedMutationGuards when auth is false', () => {
      const handler = (req: any, res: any, next: any) => {};
      const stack = __private__.buildProtectedStack({ auth: false, rateLimit: false }, handler);

      expect(stack).not.toContain(protectedMutationGuards[0]);
      // Should not wrap with asyncHandler if length >= 3
      expect(stack).toContain(handler);
      expect(asyncHandler).not.toHaveBeenCalled();
    });

    it('includes rate limiter when rateLimit is not false', () => {
      const handler = vi.fn();
      const stack = __private__.buildProtectedStack({ limiter: mockLimiter }, handler);

      expect(stack).toContain(mockLimiter);
    });

    it('includes aiConsentCheck and aiBudgetCheck when enabled', () => {
      const handler = vi.fn();
      const stack = __private__.buildProtectedStack({
        aiConsent: true,
        aiBudget: true,
        rateLimit: false
      }, handler);

      expect(stack).toContain(aiConsentCheck);
      expect(stack).toContain(aiBudgetCheck);
    });

    it('includes validation and middleware arrays', () => {
      const handler = vi.fn();
      const validation = [vi.fn()] as any;
      const middleware = [vi.fn()] as any;

      const stack = __private__.buildProtectedStack({
        rateLimit: false,
        validation,
        middleware
      }, handler);

      expect(stack).toContain(validation[0]);
      expect(stack).toContain(middleware[0]);
    });
  });

  describe('router methods', () => {
    let mockRouter: any;
    let mockHandler: any;
    let options: any;

    beforeEach(() => {
      mockRouter = {
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      };
      mockHandler = vi.fn();
      options = { rateLimit: false };
    });

    it('protectedPost maps to router.post with built stack', () => {
      protectedPost(mockRouter, '/test', options, mockHandler);
      const stack = __private__.buildProtectedStack(options, mockHandler);
      expect(mockRouter.post).toHaveBeenCalledWith('/test', ...stack);
    });

    it('protectedPatch maps to router.patch with built stack', () => {
      protectedPatch(mockRouter, '/test', options, mockHandler);
      const stack = __private__.buildProtectedStack(options, mockHandler);
      expect(mockRouter.patch).toHaveBeenCalledWith('/test', ...stack);
    });

    it('protectedDelete maps to router.delete with built stack', () => {
      protectedDelete(mockRouter, '/test', options, mockHandler);
      const stack = __private__.buildProtectedStack(options, mockHandler);
      expect(mockRouter.delete).toHaveBeenCalledWith('/test', ...stack);
    });
  });
});
