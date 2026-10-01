import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PlanProposalView } from "@/lib/api";
import type { Message } from "@/lib/chatMessage";

import { CoachPanelChatArea } from "../CoachPanelChatArea";

const PROPOSAL: PlanProposalView = {
  id: "proposal-1",
  planId: "plan-1",
  status: "pending",
  summaryMessage: "Moved your long run to Saturday.",
  changes: [],
  createdAt: "2026-10-01T10:00:00.000Z",
};

function message(id: string, overrides: Partial<Message> = {}): Message {
  return { id, role: "assistant", content: id, timestamp: "10:00", createdAtMs: 0, ...overrides };
}

function renderChat(
  messages: Message[],
  planProposal: PlanProposalView | null = null,
  onRateMessage?: (messageId: string, feedback: "up" | "down" | null) => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(
    <CoachPanelChatArea
      messages={messages}
      pendingSuggestions={[]}
      applyingId={null}
      isProcessing={false}
      onApplySuggestion={vi.fn()}
      onDismissSuggestion={vi.fn()}
      planProposal={planProposal}
      onApplyProposal={vi.fn()}
      onDismissProposal={vi.fn()}
      onRateMessage={onRateMessage}
    />,
    { wrapper },
  );
}

describe("CoachPanelChatArea", () => {
  it("shows a proposal's card at the turn that carried it, not again at the end", () => {
    renderChat(
      [
        message("Move my long run", { role: "user" }),
        message("Moved your long run to Saturday.", { kind: "proposal", proposal: PROPOSAL }),
        message("Anything else?", { role: "user" }),
      ],
      PROPOSAL,
    );

    const log = screen.getByRole("log");
    expect(within(log).getAllByTestId("plan-proposal-card-proposal-1")).toHaveLength(1);
    const card = screen.getByTestId("plan-proposal-card-proposal-1");
    const followUp = screen.getByText("Anything else?");
    // The card comes before the turn after it.
    expect(card.compareDocumentPosition(followUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByTestId("button-apply-plan-proposal")).toBeInTheDocument();
  });

  it("still shows a pending proposal whose turn isn't in view, at the end", () => {
    renderChat([message("An older reply")], PROPOSAL);
    expect(screen.getByTestId("plan-proposal-card-proposal-1")).toBeInTheDocument();
  });

  it("shows a decided proposal with its outcome", () => {
    renderChat([message("Moved it.", { kind: "proposal", proposal: { ...PROPOSAL, status: "dismissed" } })]);
    expect(screen.getByText("Dismissed — plan not changed")).toBeInTheDocument();
  });

  it("marks the day changes and the note a new session carried", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    renderChat([
      message("Old question", { role: "user", sentAtMs: yesterday.getTime() }),
      message("- The athlete has a sore knee.", { kind: "summary", sentAtMs: Date.now() - 1000 }),
      message("New question", { role: "user", sentAtMs: Date.now() }),
    ]);

    expect(screen.getAllByTestId("chat-day-separator").map((el) => el.textContent)).toEqual(["Yesterday", "Today"]);
    const note = screen.getByTestId("chat-session-summary");
    expect(note).toHaveTextContent("- The athlete has a sore knee.");
    expect(screen.queryAllByTestId("message-assistant")).toHaveLength(0);
  });

  it("offers thumbs only on the coach's saved replies", () => {
    const onRateMessage = vi.fn();
    renderChat(
      [
        message("welcome", { content: "Hi, I'm your coach." }),
        message("Today?", { role: "user" }),
        message("reply-1", { content: "Run easy.", rateable: true, feedback: "up" }),
      ],
      null,
      onRateMessage,
    );

    const feedback = screen.getAllByTestId("message-feedback");
    expect(feedback).toHaveLength(1);
    within(feedback[0]).getByRole("button", { name: "Helpful" }).click();
    expect(onRateMessage).toHaveBeenCalledWith("reply-1", null);
  });
});
