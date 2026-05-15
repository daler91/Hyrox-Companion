import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoachPanel } from "@/components/CoachPanel";

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

describe("CoachPanel", () => {
  it("welcomes new users with AI plan and Coaching Knowledge guidance", async () => {
    render(<CoachPanel isOpen={true} onClose={vi.fn()} timeline={[]} isNewUser={true} />);

    expect(await screen.findByText(/Generate an AI training plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Coaching Knowledge in Settings/i)).toBeInTheDocument();
  });
});
