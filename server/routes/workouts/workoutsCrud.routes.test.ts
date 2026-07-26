import { describe, expect,it } from "vitest";

import { uniqueIds } from "./workoutsCrud.routes";

describe("uniqueIds", () => {
  it("should return an empty array when given an empty array", () => {
    expect(uniqueIds([])).toEqual([]);
  });

  it("should return the same array if all elements are unique", () => {
    expect(uniqueIds(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("should remove duplicate ids", () => {
    expect(uniqueIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("should handle arrays with a single element", () => {
    expect(uniqueIds(["a"])).toEqual(["a"]);
  });

  it("should handle arrays with all identical elements", () => {
    expect(uniqueIds(["a", "a", "a"])).toEqual(["a"]);
  });

  it("should preserve the order of the first occurrence of each element", () => {
    expect(uniqueIds(["c", "a", "b", "c", "b", "a"])).toEqual(["c", "a", "b"]);
  });
});
