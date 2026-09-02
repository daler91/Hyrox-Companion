import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoachPanel } from "@/components/CoachPanel";

// The streak comes from the training-overview query now, so the panel needs a
// client. Left unresolved here: the welcome copy under test does not depend on
// it, and `currentStreak` falls back to 0 while the query is in flight.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, analytics: { ...actual.api.analytics, getTrainingSummary: vi.fn() } },
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
    messages: [],
    isLoading: false,
    isStreaming: false,
    scrollRef: { current: null },
    updateAutoScrollMode: vi.fn(),
    scrollToBottomIfPinned: vi.fn(),
    pinAutoScroll: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cancelStream: vi.fn(),
    clearHistory: vi.fn(),
    isClearingHistory: false,
    scrollToBottom: vi.fn(),
  }),
}));

vi.mock("@/components/coach/SuggestionsTab", () => ({
  SuggestionsList: () => null,
  useSuggestions: () => ({
    pendingSuggestions: [],
    applyingId: null,
    suggestionsRagInfo: undefined,
    suggestionsMutation: { isPending: false, mutate: vi.fn() },
    handleApplySuggestion: vi.fn(),
    handleDismissSuggestion: vi.fn(),
    clearSuggestions: vi.fn(),
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

describe("CoachPanel", () => {
  it("welcomes new users with AI plan and Coaching Knowledge guidance", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CoachPanel isOpen={true} onClose={vi.fn()} timeline={[]} isNewUser={true} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Generate an AI training plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Coaching Knowledge in Settings/i)).toBeInTheDocument();
  });
});
