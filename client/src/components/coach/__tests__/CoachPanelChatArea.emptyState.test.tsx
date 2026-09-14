import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoachPanelChatArea } from "@/components/coach/CoachPanelChatArea";

const noop = vi.fn();

describe("CoachPanelChatArea empty state", () => {
  it("shows the empty state prompt when no messages are present", () => {
    render(
      <CoachPanelChatArea
        messages={[]}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={false}
        onApplySuggestion={noop}
        onDismissSuggestion={noop}
      />,
    );
    expect(screen.getByText("Ask anything about your training")).toBeInTheDocument();
    expect(screen.getByTestId("coach-empty-state")).toBeInTheDocument();
  });

  it("hides the empty state while processing", () => {
    render(
      <CoachPanelChatArea
        messages={[]}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={true}
        onApplySuggestion={noop}
        onDismissSuggestion={noop}
      />,
    );
    expect(screen.queryByTestId("coach-empty-state")).not.toBeInTheDocument();
  });

  it("hides the empty state when messages exist", () => {
    render(
      <CoachPanelChatArea
        messages={[
          {
            id: "1",
            role: "user",
            content: "Hello",
            timestamp: "10:00 AM",
            createdAtMs: Date.now(),
          },
        ]}
        pendingSuggestions={[]}
        applyingId={null}
        isProcessing={false}
        onApplySuggestion={noop}
        onDismissSuggestion={noop}
      />,
    );
    expect(screen.queryByTestId("coach-empty-state")).not.toBeInTheDocument();
  });
});
