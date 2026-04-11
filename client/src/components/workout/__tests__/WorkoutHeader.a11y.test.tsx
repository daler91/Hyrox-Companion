import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { WorkoutHeader } from "../WorkoutHeader";

describe("WorkoutHeader a11y", () => {
  it("has no automated WCAG violations in its default state", async () => {
    const { hook } = memoryLocation({ path: "/log" });
    const { container } = render(
      <Router hook={hook}>
        <WorkoutHeader />
      </Router>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
