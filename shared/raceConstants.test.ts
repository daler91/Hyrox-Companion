import { describe, expect,it } from "vitest";

import { cohortKey,deriveAgeGroupFromAge, normalizeAgeGroup } from "./raceConstants";

describe("raceConstants", () => {
  describe("normalizeAgeGroup", () => {
    it("should return null for empty, null, or undefined inputs", () => {
      expect(normalizeAgeGroup(null)).toBeNull();
      expect(normalizeAgeGroup(undefined)).toBeNull();
      expect(normalizeAgeGroup("")).toBeNull();
      expect(normalizeAgeGroup("   ")).toBeNull();
    });

    it("should parse canonical age bands exactly", () => {
      expect(normalizeAgeGroup("16-24")).toBe("16-24");
      expect(normalizeAgeGroup("25-29")).toBe("25-29");
      expect(normalizeAgeGroup("80-84")).toBe("80-84");
    });

    it("should tolerate whitespace around the dash", () => {
      expect(normalizeAgeGroup("30 - 34")).toBe("30-34");
      expect(normalizeAgeGroup(" 35-39 ")).toBe("35-39");
      expect(normalizeAgeGroup("40  -  44")).toBe("40-44");
    });

    it("should return null for bands outside the canonical set", () => {
      // Valid format, but not in CANONICAL_AGE_BANDS
      expect(normalizeAgeGroup("10-15")).toBeNull();
      expect(normalizeAgeGroup("85-89")).toBeNull();
    });

    it("should return null for coarse or overlapping bands", () => {
      expect(normalizeAgeGroup("30-39")).toBeNull();
      expect(normalizeAgeGroup("16-29")).toBeNull();
      expect(normalizeAgeGroup("U40")).toBeNull();
      expect(normalizeAgeGroup("40+")).toBeNull();
    });

    it("should extract bands embedded in longer strings (if they match the pattern)", () => {
      // The current regex `(\d{2})\s*-\s*(\d{2})` allows leading/trailing characters
      expect(normalizeAgeGroup("Age 45-49 Division")).toBe("45-49");
    });

    it("should return null if the extracted band is not in the canonical set, even if it has numbers", () => {
       expect(normalizeAgeGroup("Age 10-14 Division")).toBeNull();
    });
  });

  describe("deriveAgeGroupFromAge", () => {
    it("should return null for null, undefined, or invalid ages", () => {
      expect(deriveAgeGroupFromAge(null)).toBeNull();
      expect(deriveAgeGroupFromAge(undefined)).toBeNull();
      expect(deriveAgeGroupFromAge(NaN)).toBeNull();
      expect(deriveAgeGroupFromAge(Infinity)).toBeNull();
    });

    it("should return null for ages under 16", () => {
      expect(deriveAgeGroupFromAge(15)).toBeNull();
      expect(deriveAgeGroupFromAge(0)).toBeNull();
      expect(deriveAgeGroupFromAge(-5)).toBeNull();
    });

    it("should map ages 16-24 to '16-24'", () => {
      expect(deriveAgeGroupFromAge(16)).toBe("16-24");
      expect(deriveAgeGroupFromAge(20)).toBe("16-24");
      expect(deriveAgeGroupFromAge(24)).toBe("16-24");
    });

    it("should cap ages 80 and over to '80-84'", () => {
      expect(deriveAgeGroupFromAge(80)).toBe("80-84");
      expect(deriveAgeGroupFromAge(85)).toBe("80-84");
      expect(deriveAgeGroupFromAge(100)).toBe("80-84");
    });

    it("should map intermediate ages to their 5-year bands", () => {
      expect(deriveAgeGroupFromAge(25)).toBe("25-29");
      expect(deriveAgeGroupFromAge(29)).toBe("25-29");
      expect(deriveAgeGroupFromAge(30)).toBe("30-34");
      expect(deriveAgeGroupFromAge(44)).toBe("40-44");
      expect(deriveAgeGroupFromAge(75)).toBe("75-79");
      expect(deriveAgeGroupFromAge(79)).toBe("75-79");
    });
  });

  describe("cohortKey", () => {
    it("should return division and gender if ageGroup is missing", () => {
      expect(cohortKey("open", "male")).toBe("open|male");
      expect(cohortKey("pro", "female", null)).toBe("pro|female");
      expect(cohortKey("pro", "female", undefined)).toBe("pro|female");
    });

    it("should return division, gender, and ageGroup if present", () => {
      expect(cohortKey("open", "male", "30-34")).toBe("open|male|30-34");
      expect(cohortKey("pro", "female", "16-24")).toBe("pro|female|16-24");
    });
  });
});
