import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { PreferenceSelectRow, PreferenceSwitchRow } from "../PreferenceRows";

const AXE_TIMEOUT_MS = 10_000;

describe("PreferenceSelectRow a11y", () => {
  it(
    "has no WCAG violations",
    async () => {
      const { container } = render(
        <PreferenceSelectRow
          label="Division"
          description="Your Hyrox race division"
          value="open"
          onValueChange={vi.fn()}
          options={[
            { value: "open", label: "Open" },
            { value: "pro", label: "Pro" },
          ]}
          testId="pref-division"
        />,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
    AXE_TIMEOUT_MS,
  );

  it("links description to select via aria-describedby", () => {
    render(
      <PreferenceSelectRow
        label="Division"
        description="Your Hyrox race division"
        value="open"
        onValueChange={vi.fn()}
        options={[{ value: "open", label: "Open" }]}
        testId="pref-division"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Division" });
    expect(trigger).toHaveAttribute("aria-describedby", "pref-division-desc");
    expect(document.getElementById("pref-division-desc")).toHaveTextContent(
      "Your Hyrox race division",
    );
  });
});

describe("PreferenceSwitchRow a11y", () => {
  it(
    "has no WCAG violations",
    async () => {
      const { container } = render(
        <PreferenceSwitchRow
          id="ai-coach"
          label="AI Coach"
          description="Enable AI-powered coaching suggestions"
          checked={true}
          onCheckedChange={vi.fn()}
          testId="pref-ai-coach"
        />,
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
    AXE_TIMEOUT_MS,
  );

  it("links description to switch via aria-describedby", () => {
    render(
      <PreferenceSwitchRow
        id="ai-coach"
        label="AI Coach"
        description="Enable AI-powered coaching suggestions"
        checked={false}
        onCheckedChange={vi.fn()}
        testId="pref-ai-coach"
      />,
    );
    const toggle = screen.getByRole("switch", { name: "AI Coach" });
    expect(toggle).toHaveAttribute("aria-describedby", "ai-coach-desc");
    expect(document.getElementById("ai-coach-desc")).toHaveTextContent(
      "Enable AI-powered coaching suggestions",
    );
  });
});
