import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Textarea } from "../textarea";

describe("Textarea error API", () => {
  it("renders no alert and is valid when errorMessage is absent", () => {
    render(<Textarea aria-label="Notes" />);
    const field = screen.getByLabelText("Notes");
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    expect(field).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the field invalid and links the error via aria-describedby", () => {
    render(<Textarea id="notes" errorMessage="Notes are required" />);
    const field = screen.getByRole("textbox");
    const alert = screen.getByRole("alert");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(alert).toHaveTextContent("Notes are required");
    expect(alert).toHaveAttribute("id", "notes-error");
    expect(field).toHaveAttribute("aria-describedby", "notes-error");
  });

  it("preserves a caller-supplied aria-describedby alongside the error id", () => {
    render(
      <Textarea
        id="notes"
        aria-describedby="hint"
        errorMessage="Too long"
      />,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-describedby",
      "hint notes-error",
    );
  });
});
