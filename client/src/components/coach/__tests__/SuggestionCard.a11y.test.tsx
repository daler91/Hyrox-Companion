import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import type { RagInfo, Suggestion } from "@/lib/api";

import { SuggestionCard } from "../SuggestionCard";

// Minimal fixture that matches the Suggestion shape the component renders.
// `as Suggestion` keeps the test lightweight — the component only reads a
// handful of fields and doesn't care about the others.
const baseSuggestion = {
  workoutId: "w-1",
  focus: "Tempo run",
  date: "2026-04-12",
  priority: "medium",
  recommendation: "Swap the recovery run for a 20-min tempo at 80% max HR.",
  rationale: "Your HRV has recovered above baseline two days in a row.",
  action: "replace",
  targetField: "mainWorkout",
} as unknown as Suggestion;

const mockRagInfo = {
  source: "rag",
  chunkCount: 2,
  chunks: ["Sample coaching note A", "Sample coaching note B"],
} as RagInfo;

describe("SuggestionCard a11y", () => {
  it("has no automated WCAG violations in the default state", async () => {
    const { container } = render(
      <SuggestionCard
        suggestion={baseSuggestion}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
        isApplying={false}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no automated WCAG violations while applying", async () => {
    const { container } = render(
      <SuggestionCard
        suggestion={baseSuggestion}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
        isApplying={true}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no automated WCAG violations with a RAG citation badge", async () => {
    const { container } = render(
      <SuggestionCard
        suggestion={baseSuggestion}
        ragInfo={mockRagInfo}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
        isApplying={false}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
