import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { RpeSelector } from "../RpeSelector";

describe("RpeSelector a11y", () => {
  it("has no WCAG violations with no value selected", async () => {
    const { container } = render(
      <RpeSelector value={null} onChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations with a value selected", async () => {
    const { container } = render(
      <RpeSelector value={7} onChange={vi.fn()} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations in compact mode without a visible legend", async () => {
    const { container } = render(
      <RpeSelector value={null} onChange={vi.fn()} compact showLabel={false} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
