import { describe, expect, it, vi } from "vitest";

import { type AdvisoryLockPool, withPgAdvisoryLock } from "./advisoryLock";

function makePool(acquired: boolean): {
  readonly pool: AdvisoryLockPool;
  readonly query: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
} {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ acquired }] })
    .mockResolvedValue({ rows: [{ released: true }] });
  const release = vi.fn();

  return {
    pool: {
      connect: vi.fn().mockResolvedValue({ query, release }),
    },
    query,
    release,
  };
}

describe("withPgAdvisoryLock", () => {
  it("runs protected work when the advisory lock is acquired", async () => {
    const { pool, query, release } = makePool(true);
    const run = vi.fn().mockResolvedValue("done");

    const result = await withPgAdvisoryLock(pool, { key: 4_200_001n, name: "daily-email" }, run);

    expect(result).toEqual({ acquired: true, value: "done" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      ["4200001"],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1::bigint) AS released",
      ["4200001"],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("skips protected work when the advisory lock is already held", async () => {
    const { pool, query, release } = makePool(false);
    const run = vi.fn().mockResolvedValue("done");

    const result = await withPgAdvisoryLock(pool, { key: 4_200_002n, name: "cleanup" }, run);

    expect(result).toEqual({ acquired: false, value: undefined });
    expect(run).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the advisory lock when protected work throws", async () => {
    const { pool, query, release } = makePool(true);
    const error = new Error("job failed");

    await expect(
      withPgAdvisoryLock(pool, { key: 4_200_003n, name: "failing-job" }, async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    expect(query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1::bigint) AS released",
      ["4200003"],
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
