import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import NotFound from "../not-found";

describe("NotFound a11y", () => {
  it("has no automated WCAG violations", async () => {
    const { hook } = memoryLocation({ path: "/nonexistent" });
    const { container } = render(
      <Router hook={hook}>
        <NotFound />
      </Router>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
