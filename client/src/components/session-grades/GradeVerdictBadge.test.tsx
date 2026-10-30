import type { SessionGradeVerdict } from "@shared/schema";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradeVerdictBadge } from "./GradeVerdictBadge";

describe("GradeVerdictBadge", () => {
  it("renders the verdict label without a tab stop or tooltip when there is no headline", () => {
    render(<GradeVerdictBadge intent="easy" verdict="on_target" testId="badge" />);

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("Stayed easy");
    expect(badge).not.toHaveAttribute("tabindex");
    expect(badge).not.toHaveAttribute("title");
  });

  it("treats an empty headline like no headline", () => {
    render(<GradeVerdictBadge intent="easy" verdict="on_target" headline="" testId="badge" />);

    expect(screen.getByTestId("badge")).not.toHaveAttribute("tabindex");
  });

  it("makes the badge keyboard-focusable and shows the headline as a tooltip when focused", async () => {
    render(
      <GradeVerdictBadge
        intent="threshold"
        verdict="too_hard"
        headline="Heart rate stayed above zone 4"
        testId="badge"
      />,
    );

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveAttribute("tabindex", "0");
    // The native title attribute was replaced by the tooltip, which touch and keyboard users can reach.
    expect(badge).not.toHaveAttribute("title");

    fireEvent.focus(badge);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Heart rate stayed above zone 4");
  });

  it.each<[SessionGradeVerdict, string]>([
    ["crept_up", "Crept up"],
    ["too_hard", "Too hard"],
    ["drifted_harder", "Drifted harder"],
    ["under", "Under threshold"],
    ["inconclusive", "Can't tell"],
    ["ungradeable", "Not graded"],
  ])("labels the %s verdict as %s and hides its decorative icon from assistive tech", (verdict, label) => {
    render(<GradeVerdictBadge intent="threshold" verdict={verdict} testId="badge" />);

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent(label);
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("words on_target by intent", () => {
    render(<GradeVerdictBadge intent="threshold" verdict="on_target" testId="badge" />);

    expect(screen.getByTestId("badge")).toHaveTextContent("Held threshold");
  });
});
