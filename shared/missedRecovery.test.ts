import { describe, expect, it } from "vitest";

import { formatSessionLength } from "./missedRecovery";

describe("formatSessionLength", () => {
  it("reads minutes under an hour, hours and minutes above", () => {
    expect(formatSessionLength(45)).toBe("45 min");
    expect(formatSessionLength(44.6)).toBe("45 min");
    expect(formatSessionLength(60)).toBe("1h");
    expect(formatSessionLength(95)).toBe("1h 35m");
    expect(formatSessionLength(135)).toBe("2h 15m");
  });
});
