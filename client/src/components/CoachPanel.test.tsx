import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoachPanel } from "@/components/CoachPanel";
import { api } from "@/lib/api";

const chatSession = vi.hoisted(() => ({ sendMessage: vi.fn(), welcomes: [] as Array<string | undefined> }));

// The streak comes from the training-overview query now, so the panel needs a
// client. Left unresolved here: the welcome copy under test does not depend on
// it, and `currentStreak` falls back to 0 while the query is in flight.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      analytics: { ...actual.api.analytics, getTrainingSummary: vi.fn() },
      chat: { ...actual.api.chat, getWelcome: vi.fn() },
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
  useChatSession: (options: { welcomeMessage?: string }) => {
    chatSession.welcomes.push(options.welcomeMessage);
    return {
    messages: [],
    isLoading: false,
    isStreaming: false,
    scrollRef: { current: null },
    updateAutoScrollMode: vi.fn(),
    scrollToBottomIfPinned: vi.fn(),
    pinAutoScroll: vi.fn(),
    sendMessage: chatSession.sendMessage,
    cancelStream: vi.fn(),
    clearHistory: vi.fn(),
    isClearingHistory: false,
    scrollToBottom: vi.fn(),
    };
  },
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

function renderPanel(isNewUser = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CoachPanel isOpen onClose={vi.fn()} timeline={[]} isNewUser={isNewUser} />
    </QueryClientProvider>,
  );
}

describe("CoachPanel", () => {
  beforeEach(() => {
    chatSession.sendMessage.mockReset().mockImplementation(() => Promise.resolve());
    chatSession.welcomes.length = 0;
    // Pending unless a test resolves it: the panel shows its own chips meanwhile.
    // vi.fn() as the executor: a promise that never settles.
    vi.mocked(api.chat.getWelcome).mockReturnValue(new Promise(vi.fn()));
  });

  it("opens with the welcome built from the athlete's training, and its chips send their message", async () => {
    vi.mocked(api.chat.getWelcome).mockResolvedValue({
      greeting: "Hi Sam! Today: Intervals. What would you like to work on?",
      quickActions: [
        { id: "today-session", label: "Pacing for today's Intervals", message: "How should I pace today's Intervals?" },
        { id: "tomorrow", label: "What should I do tomorrow?" },
      ],
    });
    renderPanel();

    fireEvent.click(await screen.findByTestId("button-action-today-session"));

    expect(chatSession.sendMessage).toHaveBeenCalledWith("How should I pace today's Intervals?");
    expect(chatSession.welcomes.at(-1)).toBe("Hi Sam! Today: Intervals. What would you like to work on?");
    fireEvent.click(screen.getByTestId("button-action-tomorrow"));
    expect(chatSession.sendMessage).toHaveBeenLastCalledWith("What should I do tomorrow?");
  });

  it("shows its own chips until the welcome arrives", () => {
    renderPanel();

    expect(screen.getByTestId("button-action-suggestions")).toBeInTheDocument();
    expect(chatSession.welcomes.at(-1)).toBeUndefined();
  });

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
