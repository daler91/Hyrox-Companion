import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoachPanel } from "@/components/CoachPanel";
import type { Message } from "@/lib/chatMessage";

// The real suggestions hook runs here (CoachPanel.test.tsx stubs it out): the
// bug this guards was in the messages that hook builds, not in the panel's sort.

const { hookMessages, getSuggestions } = vi.hoisted(() => ({
  hookMessages: [] as Message[],
  getSuggestions: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: { ...actual.api.analytics, getTrainingSummary: vi.fn() },
      timeline: { ...actual.api.timeline, getSuggestions },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { trainingStyleId: "balanced_default" } }),
}));

vi.mock("@/hooks/useChatMutations", () => ({
  useSaveMessageMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useChatSession", () => ({
  useChatSession: () => ({
    messages: hookMessages,
    isLoading: false,
    isStreaming: false,
    scrollRef: { current: null },
    updateAutoScrollMode: vi.fn(),
    scrollToBottomIfPinned: vi.fn(),
    pinAutoScroll: vi.fn(),
    sendMessage: vi.fn(() => Promise.resolve()),
    cancelStream: vi.fn(),
    clearHistory: vi.fn(),
    isClearingHistory: false,
    scrollToBottom: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePlanProposal", () => ({
  usePlanProposal: () => ({
    proposal: null,
    isApplyingProposal: false,
    applyProposal: vi.fn(),
    dismissProposal: vi.fn(),
  }),
}));

function bubbleTexts(): string[] {
  return screen
    .getAllByTestId(/^message-(user|assistant)$/)
    .map((bubble) => bubble.textContent ?? "");
}

describe("CoachPanel message order", () => {
  it("renders the suggestions reply after the question that produced it", async () => {
    hookMessages.splice(
      0,
      hookMessages.length,
      { id: "welcome", role: "assistant", content: "Hi, I'm your coach.", timestamp: "", createdAtMs: 0 },
      // Hydrated history: older than anything in this session.
      { id: "h1", role: "user", content: "An older question", timestamp: "", createdAtMs: 0 },
      // Sent earlier in this session.
      {
        id: "s1",
        role: "user",
        content: "How was my week?",
        timestamp: "",
        createdAtMs: Date.now() - 60_000,
      },
    );
    getSuggestions.mockResolvedValue({ suggestions: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CoachPanel isOpen onClose={vi.fn()} timeline={[]} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("button-action-suggestions"));
    await screen.findByText(/upcoming workouts look well-balanced/i);

    const texts = bubbleTexts();
    const question = texts.findIndex((t) => t.includes("Get workout suggestions"));
    const reply = texts.findIndex((t) => /well-balanced/i.test(t));
    const earlier = texts.findIndex((t) => t.includes("How was my week?"));

    expect(earlier).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(earlier);
    expect(reply).toBeGreaterThan(question);
    expect(reply).toBe(texts.length - 1);
  });
});
