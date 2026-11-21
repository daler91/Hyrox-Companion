// @vitest-environment node
/**
 * SonarQube Cloud reads one of two files: `.sonarcloud.properties` under
 * Automatic Analysis (what this project uses) and `sonar-project.properties`
 * under a CI-based scan. The second declared a much narrower test set
 * (`client/src/hooks/__tests__,server/routes/__tests__`), so switching to the
 * CI scanner would have scanned most test files as production source (tech
 * debt #67). These checks keep the two classifying files the same way.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** `key=value` lines of a .properties file, ignoring comments and blank lines. */
function readProperties(file: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of readFileSync(path.join(ROOT, file), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) props.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return props;
}

function list(props: Map<string, string>, key: string): string[] {
  return (props.get(key) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const automatic = readProperties(".sonarcloud.properties");
const ciScan = readProperties("sonar-project.properties");

describe("SonarQube Cloud configuration", () => {
  it("declares the same test files for a CI-based scan as for Automatic Analysis", () => {
    expect(list(ciScan, "sonar.tests").sort()).toEqual(list(automatic, "sonar.tests").sort());
    expect(list(ciScan, "sonar.test.inclusions").sort()).toEqual(list(automatic, "sonar.test.inclusions").sort());
  });

  it("excludes from a CI-based scan everything Automatic Analysis excludes", () => {
    expect(list(ciScan, "sonar.exclusions")).toEqual(expect.arrayContaining(list(automatic, "sonar.exclusions")));
  });

  it("keeps test files out of a CI-based scan's sources, so none is indexed twice", () => {
    expect(list(ciScan, "sonar.exclusions")).toEqual(expect.arrayContaining(list(ciScan, "sonar.test.inclusions")));
  });

  it("drops the same data tables from duplication detection", () => {
    expect(list(ciScan, "sonar.cpd.exclusions").sort()).toEqual(list(automatic, "sonar.cpd.exclusions").sort());
  });
});
