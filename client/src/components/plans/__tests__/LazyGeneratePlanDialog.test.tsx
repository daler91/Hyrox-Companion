import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LazyGeneratePlanDialog } from "../LazyGeneratePlanDialog";

const loadDialog = vi.fn();

vi.mock("@/components/plans/GeneratePlanDialog", () => {
  loadDialog();
  return {
    GeneratePlanDialog: ({ open }: { open: boolean }) => (
      <div data-testid="generate-plan-dialog" data-open={String(open)} />
    ),
  };
});

describe("LazyGeneratePlanDialog", () => {
  it("renders nothing and loads no chunk until it first opens", () => {
    render(<LazyGeneratePlanDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId("generate-plan-dialog")).not.toBeInTheDocument();
    expect(loadDialog).not.toHaveBeenCalled();
  });

  it("mounts on first open and stays mounted after it closes", async () => {
    const { rerender } = render(<LazyGeneratePlanDialog open={false} onOpenChange={vi.fn()} />);
    rerender(<LazyGeneratePlanDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByTestId("generate-plan-dialog")).toHaveAttribute("data-open", "true");

    rerender(<LazyGeneratePlanDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("generate-plan-dialog")).toHaveAttribute("data-open", "false");
  });
});
