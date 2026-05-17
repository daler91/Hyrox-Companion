import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";

import { pool } from "./db";

export class PostgresRateLimitStore implements Store {
  localKeys = false;
  prefix: string;

  private windowMs: number;

  constructor(category: string, windowMs: number) {
    this.prefix = `pg:${category}:`;
    this.windowMs = windowMs;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const result = await pool.query<{ hit_count: number; reset_at: Date }>(
      `select hit_count, reset_at
       from rate_limit_buckets
       where key = $1
         and reset_at > now()`,
      [key],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return { totalHits: Number(row.hit_count), resetTime: row.reset_at };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const resetAt = new Date(Date.now() + this.windowMs);
    const result = await pool.query<{ hit_count: number; reset_at: Date }>(
      `insert into rate_limit_buckets (key, hit_count, reset_at, updated_at)
       values ($1, 1, $2, now())
       on conflict (key) do update
         set hit_count = case
               when rate_limit_buckets.reset_at <= now() then 1
               else rate_limit_buckets.hit_count + 1
             end,
             reset_at = case
               when rate_limit_buckets.reset_at <= now() then excluded.reset_at
               else rate_limit_buckets.reset_at
             end,
             updated_at = now()
       returning hit_count, reset_at`,
      [key, resetAt],
    );
    const row = result.rows[0];
    return { totalHits: Number(row.hit_count), resetTime: row.reset_at };
  }

  async decrement(key: string): Promise<void> {
    await pool.query(
      `update rate_limit_buckets
       set hit_count = greatest(hit_count - 1, 0),
           updated_at = now()
       where key = $1
         and reset_at > now()`,
      [key],
    );
  }

  async resetKey(key: string): Promise<void> {
    await pool.query("delete from rate_limit_buckets where key = $1", [key]);
  }

  async resetAll(): Promise<void> {
    await pool.query("delete from rate_limit_buckets");
  }
}
