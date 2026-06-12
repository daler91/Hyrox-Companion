import { render, screen } from "@testing-library/react";
import { Dumbbell } from "lucide-react";
import { describe, expect, it } from "vitest";

import { CoachRationaleSection, DetailSection } from "../DetailSection";

describe("DetailSection", () => {
  it("renders the title, content, and action slot", () => {
    render(
      <DetailSection
        title="Results"
        icon={Dumbbell}
        action={<span data-testid="section-action">saved</span>}
        testId="section-results"
      >
        <p>table goes here</p>
      </DetailSection>,
    );

    const section = screen.getByTestId("section-results");
    expect(section.tagName).toBe("SECTION");
    expect(section).toHaveTextContent("Results");
    expect(section).toHaveTextContent("table goes here");
    expect(screen.getByTestId("section-action")).toBeInTheDocument();
  });

  it("renders as a closed <details> when collapsible", () => {
    render(
      <DetailSection title="Training plan" collapsible testId="section-plan">
        <p>picker</p>
      </DetailSection>,
    );

    const section = screen.getByTestId("section-plan");
    expect(section.tagName).toBe("DETAILS");
    expect(section).not.toHaveAttribute("open");
  });

  it("opens a collapsible section by default when asked", () => {
    render(
      <DetailSection title="Training plan" collapsible defaultOpen testId="section-plan">
        <p>picker</p>
      </DetailSection>,
    );

    expect(screen.getByTestId("section-plan")).toHaveAttribute("open");
  });
});

describe("CoachRationaleSection", () => {
  it("renders nothing without a rationale", () => {
    const { container } = render(<CoachRationaleSection rationale={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the rationale open under the given title", () => {
    render(
      <CoachRationaleSection
        rationale="Leg strength before the run stations."
        title="Why this workout"
        testId="rationale-card"
      />,
    );

    const card = screen.getByTestId("rationale-card");
    expect(card).toHaveTextContent("Why this workout");
    expect(card).toHaveTextContent("Leg strength before the run stations.");
    // An open card, not a <details> disclosure — the rationale should
    // not need a tap to read.
    expect(card.tagName).toBe("SECTION");
  });
});
