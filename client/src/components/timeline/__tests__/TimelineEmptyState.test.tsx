import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import TimelineEmptyState from "../TimelineEmptyState";

// Regression guard for the Codex P1 fix preserved from the now-deleted
// TimelineAnnotationsBanner test: a clean account (no plans, no workouts)
// must still have a visible entry point to the AnnotationsDialog. Before
// this PR, that entry point was the banner; now it's the "Log a note"
// button rendered inside the welcome empty state.

function renderWelcome({ onLogNote }: { onLogNote?: () => void } = {}) {
  // The welcome variant eagerly mounts GeneratePlanDialog, which uses
  // react-query hooks internally — so this test needs a provider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineEmptyState
        filterStatus="all"
        selectedPlanId={null}
        plans={[]}
        samplePlanMutation={{ mutate: vi.fn(), isPending: false }}
        importMutation={{ isPending: false }}
        handleFileUpload={vi.fn()}
        setSchedulingPlanId={vi.fn()}
        setFilterStatus={vi.fn()}
        onLogNote={onLogNote}
      />
    </QueryClientProvider>,
  );
}

describe("TimelineEmptyState", () => {
  it("renders the Log a note button in the welcome state when onLogNote is provided", async () => {
    const onLogNote = vi.fn();
    renderWelcome({ onLogNote });

    const button = await screen.findByTestId("button-log-note-empty");
    expect(button).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(onLogNote).toHaveBeenCalledTimes(1);
  });

  it("does not render the Log a note button when onLogNote is omitted", () => {
    renderWelcome();
    expect(screen.queryByTestId("button-log-note-empty")).toBeNull();
  });
});
