import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { generateIconsKotlin, type IconNode, toPathData } from "./generate";
import { ICONS_KT, LICENSE_TXT, loadIcons, lucideLicense, lucideVersion } from "./icons";

describe("committed Lucide icons", () => {
  it("are what lucide-react generates (run `pnpm mobile:icons` after changing ICONS or upgrading Lucide)", async () => {
    expect(readFileSync(ICONS_KT, "utf8")).toBe(generateIconsKotlin(await loadIcons(), lucideVersion()));
  });

  it("ship Lucide's licence", () => {
    expect(readFileSync(LICENSE_TXT, "utf8")).toBe(lucideLicense());
  });
});

describe("generateIconsKotlin", () => {
  it("fills only the icons marked filled", () => {
    const star: IconNode[] = [["path", { d: "M1 1h2" }]];
    const kotlin = generateIconsKotlin({ Star: star, StarFilled: star }, "0.0.0");
    expect(kotlin).toContain(`val Star: ImageVector by lazy {\n        lucide(\n            "Star",\n            "M1 1h2",\n        )`);
    expect(kotlin).toContain(
      `val StarFilled: ImageVector by lazy {\n        lucide(\n            "StarFilled",\n            "M1 1h2",\n            filled = true,\n        )`,
    );
  });
});

describe("toPathData", () => {
  it("passes path data through", () => {
    expect(toPathData(["path", { d: "M3 9h18" }])).toBe("M3 9h18");
  });

  it("draws a rounded rect as four sides and four arcs", () => {
    expect(toPathData(["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }])).toBe(
      "M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3Z",
    );
  });

  it("draws a square-cornered rect as a closed box", () => {
    expect(toPathData(["rect", { x: "1", y: "2", width: "3", height: "4" }])).toBe("M1 2H4V6H1Z");
  });

  it("draws a circle as two half arcs", () => {
    expect(toPathData(["circle", { cx: "12", cy: "12", r: "3" }])).toBe("M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z");
  });

  it("draws lines and polylines", () => {
    expect(toPathData(["line", { x1: "1", y1: "2", x2: "3", y2: "4" }])).toBe("M1 2L3 4");
    expect(toPathData(["polyline", { points: "1,2 3,4 5,6" }])).toBe("M1 2L3 4L5 6");
    expect(toPathData(["polygon", { points: "1 2 3 4 5 6" }])).toBe("M1 2L3 4L5 6Z");
  });

  it("rejects an element it can't convert", () => {
    expect(() => toPathData(["text", {}])).toThrow("Unsupported Lucide element <text>");
  });
});
