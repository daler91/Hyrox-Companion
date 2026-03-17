import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("should merge strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("should handle falsy values", () => {
    expect(cn("a", null, "b", undefined, "c", false, "", 0, "d")).toBe("a b c d");
  });

  it("should merge tailwind classes properly using twMerge", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    expect(cn("bg-red-500", "bg-blue-500 hover:bg-green-500")).toBe("bg-blue-500 hover:bg-green-500");
  });

  it("should handle arrays and objects using clsx", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
    expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
  });

  it("should handle complex combinations of clsx and twMerge", () => {
    expect(
      cn(
        "p-4 text-red-500",
        {
          "p-8": true,
          "text-blue-500": false,
        },
        ["bg-gray-100", "hover:bg-gray-200"],
        "bg-white"
      )
    ).toBe("text-red-500 p-8 hover:bg-gray-200 bg-white");
  });
});
