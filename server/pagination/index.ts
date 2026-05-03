import { z } from "zod";

export const PAGINATION_MIN_LIMIT = 1;
export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;

const numericQuery = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number.parseInt(v, 10)))
  .refine((v) => Number.isFinite(v), { message: "must be a number" });

function clampLimit(limit: number, maxLimit: number): number {
  return Math.min(Math.max(limit, PAGINATION_MIN_LIMIT), maxLimit);
}

export function parseOffsetPagination(query: { limit?: string; offset?: string }, options?: { defaultLimit?: number; maxLimit?: number }) {
  const defaultLimit = options?.defaultLimit ?? PAGINATION_DEFAULT_LIMIT;
  const maxLimit = options?.maxLimit ?? PAGINATION_MAX_LIMIT;
  const parsedLimit = query.limit === undefined ? defaultLimit : numericQuery.safeParse(query.limit);
  if (parsedLimit !== defaultLimit && !parsedLimit.success) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid limit" } };
  const rawLimit = typeof parsedLimit === "number" ? parsedLimit : parsedLimit.data;
  if (!Number.isInteger(rawLimit) || rawLimit < PAGINATION_MIN_LIMIT) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid limit" } };

  const parsedOffset = query.offset === undefined ? 0 : numericQuery.safeParse(query.offset);
  if (parsedOffset !== 0 && !parsedOffset.success) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid offset" } };
  const offset = typeof parsedOffset === "number" ? parsedOffset : parsedOffset.data;
  if (!Number.isInteger(offset) || offset < 0) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid offset" } };

  return { ok: true as const, value: { limit: clampLimit(rawLimit, maxLimit), offset } };
}

export function parseCursorPagination(query: { limit?: string; cursor?: string }, options?: { defaultLimit?: number; maxLimit?: number }) {
  const defaultLimit = options?.defaultLimit ?? PAGINATION_DEFAULT_LIMIT;
  const maxLimit = options?.maxLimit ?? PAGINATION_MAX_LIMIT;
  const parsedLimit = query.limit === undefined ? defaultLimit : numericQuery.safeParse(query.limit);
  if (parsedLimit !== defaultLimit && !parsedLimit.success) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid limit" } };
  const rawLimit = typeof parsedLimit === "number" ? parsedLimit : parsedLimit.data;
  if (!Number.isInteger(rawLimit) || rawLimit < PAGINATION_MIN_LIMIT) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid limit" } };

  let cursor: string | undefined = undefined;
  if (query.cursor !== undefined) {
    if (query.cursor.trim().length === 0) return { ok: false as const, error: { code: "BAD_REQUEST" as const, error: "Invalid cursor" } };
    cursor = query.cursor;
  }

  return { ok: true as const, value: { limit: clampLimit(rawLimit, maxLimit), cursor } };
}

export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
  offset?: number;
}
