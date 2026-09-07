import { describe, expect, it } from "vitest";

import { BENCHMARK_RESULT_PREFIX, parseBenchmarkRows } from "./timelineBenchmarkFormat";

/**
 * The timeline perf guard used to read its numbers out of `console.table`'s
 * box-drawing output, slicing `│`-delimited cells by counting from the right.
 * Every case below is something that broke — or silently corrupted — that
 * reader while the code under test was performing exactly as before.
 */

const ROW = {
  name: "medium",
  planned: 10_000,
  logged: 10_000,
  limit: 50,
  offset: 0,
  returned: 50,
  parity: true,
  ms: 75.92,
  heapMb: 5.08,
};

const line = (rows: unknown[]) => `${BENCHMARK_RESULT_PREFIX}${JSON.stringify(rows)}`;

describe("parseBenchmarkRows", () => {
  it("reads the rows by field name, whatever the table above them looks like", () => {
    const stdout = [
      "┌─────────┬───────────────┬────────┬────────┐",
      "│ (index) │ name          │ heapMb │ ms     │", // columns swapped vs. before
      "│ 0       │ 'medium'      │ 5.08   │ 75.92  │",
      "└─────────┴───────────────┴────────┴────────┘",
      line([ROW]),
      "",
    ].join("\n");

    expect(parseBenchmarkRows(stdout)).toEqual([ROW]);
  });

  it("keeps parity a boolean instead of the string the table rendered", () => {
    const [row] = parseBenchmarkRows(line([{ ...ROW, parity: false }]));
    // The old reader compared against 'true', so a `false` cell and a truncated
    // one were indistinguishable — and any non-'true' text failed the run.
    expect(row.parity).toBe(false);
    expect(typeof row.parity).toBe("boolean");
  });

  it("survives a name long enough to have wrapped the table", () => {
    const wide = { ...ROW, name: "high-offset-with-a-very-long-case-name" };
    expect(parseBenchmarkRows(line([wide]))[0]?.name).toBe(wide.name);
  });

  it("keeps the unbounded case's non-numeric limit intact", () => {
    expect(parseBenchmarkRows(line([{ ...ROW, limit: "none" }]))[0]?.limit).toBe("none");
  });

  it("takes the last results line, since the child's output is echoed", () => {
    const stdout = [line([ROW]), line([{ ...ROW, ms: 99 }])].join("\n");
    expect(parseBenchmarkRows(stdout)[0]?.ms).toBe(99);
  });

  it("says the benchmark did not finish rather than reporting zero rows", () => {
    // The old reader's filter simply matched nothing here, so the guard fell
    // through to "missing benchmark row: medium" — technically a failure, but
    // one that reads like a renamed case rather than a crashed benchmark.
    expect(() => parseBenchmarkRows("Error: heap out of memory\n")).toThrow(
      /produced no "timeline-benchmark-json:" line/,
    );
  });

  it("rejects a results line that is not an array of rows", () => {
    expect(() => parseBenchmarkRows(line({ name: "medium" } as never))).toThrow(
      /did not hold an array/,
    );
  });
});
