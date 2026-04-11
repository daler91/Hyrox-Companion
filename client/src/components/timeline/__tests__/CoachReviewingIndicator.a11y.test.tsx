import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { CoachReviewingIndicator } from "../CoachReviewingIndicator";

describe("CoachReviewingIndicator a11y", () => {
  it("renders nothing with no violations when inactive", async () => {
    const { container } = render(<CoachReviewingIndicator isActive={false} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no automated WCAG violations when active (live region + icon)", async () => {
    const { container } = render(<CoachReviewingIndicator isActive={true} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
