import type { TimelineAnnotation } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineAnnotationCard } from "../TimelineAnnotationCard";

function makeAnnotation(overrides: Partial<TimelineAnnotation> = {}): TimelineAnnotation {
  return {
    id: "a1",
    userId: "user-1",
    startDate: "2026-03-01",
    endDate: "2026-03-07",
    type: "injury",
    note: "Calf strain",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TimelineAnnotation;
}

describe("TimelineAnnotationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the type label, inclusive day count, and note body", () => {
    render(
      <TimelineAnnotationCard
        annotation={makeAnnotation()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const card = screen.getByTestId("annotation-card-a1");
    expect(card).toHaveTextContent(/injury/i);
    // Inclusive count: March 1 → March 7 = 7 days
    expect(card).toHaveTextContent("2026-03-01 → 2026-03-07 · 7 days");
    expect(card).toHaveTextContent("Calf strain");
  });

  it("renders single-day ranges as '1 day' without the arrow", () => {
    render(
      <TimelineAnnotationCard
        annotation={makeAnnotation({
          id: "a-single",
          startDate: "2026-03-01",
          endDate: "2026-03-01",
          note: null,
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const card = screen.getByTestId("annotation-card-a-single");
    expect(card).toHaveTextContent("2026-03-01 · 1 day");
    expect(card).not.toHaveTextContent("→");
  });

  it("invokes onEdit when the pencil button is clicked", async () => {
    const onEdit = vi.fn();
    const annotation = makeAnnotation();
    render(
      <TimelineAnnotationCard
        annotation={annotation}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-edit-annotation-a1"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(annotation);
  });

  it("invokes onDelete with the annotation id when the trash button is clicked", async () => {
    const onDelete = vi.fn();
    render(
      <TimelineAnnotationCard
        annotation={makeAnnotation()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-delete-annotation-a1"));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("disables the trash button while a delete is pending", () => {
    render(
      <TimelineAnnotationCard
        annotation={makeAnnotation()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDeleting
      />,
    );

    expect(screen.getByTestId("button-delete-annotation-a1")).toBeDisabled();
  });
});
