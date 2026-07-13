import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { BulkDeleteToolbar } from "../BulkDeleteToolbar";

const noop = vi.fn();

const defaultProps = {
  selectedCount: 3,
  visibleCount: 5,
  isPending: false,
  onSelectAll: noop,
  onClear: noop,
  onCancel: noop,
  onDelete: noop,
};

describe("BulkDeleteToolbar a11y", () => {
  it("has no automated WCAG violations", async () => {
    const { container } = render(<BulkDeleteToolbar {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("announces selection count changes via aria-live", () => {
    render(<BulkDeleteToolbar {...defaultProps} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("3 selected");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
