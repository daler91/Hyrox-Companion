import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CharacterCount } from "../character-count";

describe("CharacterCount", () => {
  it("renders a visible count and a screen-reader remaining hint", () => {
    render(<CharacterCount id="note-count" value="hello" max={500} />);

    expect(screen.getByText("5/500")).toBeInTheDocument();
    expect(screen.getByText(/495 characters remaining/)).toBeInTheDocument();
  });

  it("uses aria-live=polite so updates announce without stealing focus", () => {
    render(<CharacterCount id="note-count" value="" max={500} />);

    const counter = screen.getByTestId("character-count-note-count");
    expect(counter).toHaveAttribute("aria-live", "polite");
    expect(counter).toHaveAttribute("id", "note-count");
  });

  it("switches to the near-limit color within the last 10% of the budget", () => {
    const { rerender } = render(
      <CharacterCount id="c" value={"x".repeat(400)} max={500} />,
    );
    expect(screen.getByTestId("character-count-c").className).toContain("text-muted-foreground");

    rerender(<CharacterCount id="c" value={"x".repeat(490)} max={500} />);
    expect(screen.getByTestId("character-count-c").className).toContain("text-amber-600");
  });
});
