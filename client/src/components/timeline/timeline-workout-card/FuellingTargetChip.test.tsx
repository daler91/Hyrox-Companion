import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { makeTimelineEntry } from "@/test/factories/timelineEntryFactory";
import { renderWithBodyweight } from "@/test/support/renderWithBodyweight";

import { FuellingTargetChip } from "./FuellingTargetChip";

vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    preferences: ["/api/v1/preferences"],
    nutritionPlannedSessionEstimate: (planDayId: string) => ["/api/v1/nutrition/planned-session-estimate", planDayId],
  },
}));

type Blocks = TimelineEntry["structureBlocks"];

function makeEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return makeTimelineEntry({ date: "2026-06-10", ...over });
}

function renderWithClient(ui: ReactNode, bodyweightKg: number | null = 75) {
  return renderWithBodyweight(ui, QUERY_KEYS.preferences, bodyweightKg);
}

describe("FuellingTargetChip", () => {
  it("shows a pre-fuel target estimated from the planned exercise table", () => {
    const entry = makeEntry({
      structureBlocks: [
        { sectionType: "main", formatType: "for_time", timeCapMinutes: 45 },
      ] as unknown as Blocks,
    });
    renderWithClient(<FuellingTargetChip entry={entry} />);

    expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent(
      "Fuel ~30g carbs before",
    );
  });

  it("prefers the saved expected duration and RPE over the estimate", () => {
    const entry = makeEntry({
      expectedDurationMin: 90,
      expectedRpe: 9,
      structureBlocks: [
        { sectionType: "main", formatType: "steady", durationMinutes: 20 },
      ] as unknown as Blocks,
    });
    renderWithClient(<FuellingTargetChip entry={entry} />);

    expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent("61g");
  });

  it("shows the post-recovery target even when no pre-fuelling is needed", () => {
    renderWithClient(
      <FuellingTargetChip entry={makeEntry({ expectedDurationMin: 30, expectedRpe: 3 })} />,
    );

    const chip = screen.getByTestId("fuelling-target-chip-entry-1");
    expect(chip).toHaveTextContent("after");
    expect(chip).not.toHaveTextContent("before");
  });

  it("falls back to the baseline target when bodyweight is unknown", () => {
    renderWithClient(<FuellingTargetChip entry={makeEntry()} />, null);

    expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent("30g");
  });

  it("shows both pre-fuel and post-recovery for a moderate session", () => {
    renderWithClient(
      <FuellingTargetChip entry={makeEntry({ expectedDurationMin: 60, expectedRpe: 6 })} />,
    );

    const chip = screen.getByTestId("fuelling-target-chip-entry-1");
    expect(chip).toHaveTextContent("before");
    expect(chip).toHaveTextContent("after");
    expect(chip).toHaveTextContent("53g"); // post carbs (60min/rpe6/75kg)
    expect(chip).toHaveTextContent("23g"); // post protein
  });
  // Tech debt #59: the chip ran only the local estimate, which cannot know the
  // athlete's run pace, while the panel moved on to the server's, so the card
  // and the sheet could quote different targets.
  describe("which estimate it starts from", () => {
    const shortForTime = [{ sectionType: "main", formatType: "for_time", timeCapMinutes: 45 }] as unknown as Blocks;

    it("prefers the timeline's pace-personalised sessionEstimate to the local one", () => {
      const entry = makeEntry({
        structureBlocks: shortForTime,
        sessionEstimate: { durationMin: 90, rpe: 9, source: "structure", clamped: false },
      });
      renderWithClient(<FuellingTargetChip entry={entry} />);

      // 90 min at RPE 9, the saved-values case above; the local estimate gives 30g.
      expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent("61g");
    });

    it("uses the panel's estimate once the panel has fetched it, and never fetches it itself", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      queryClient.setQueryData(["/api/v1/preferences"], { bodyweightKg: 75 });
      const entry = makeEntry({ planDayId: "day-1", structureBlocks: shortForTime });

      render(
        <QueryClientProvider client={queryClient}>
          <FuellingTargetChip entry={entry} />
        </QueryClientProvider>,
      );
      expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent("~30g carbs before");
      expect(queryClient.getQueryState(["/api/v1/nutrition/planned-session-estimate", "day-1"])?.fetchStatus).not.toBe(
        "fetching",
      );

      queryClient.setQueryData(["/api/v1/nutrition/planned-session-estimate", "day-1"], {
        planDayId: "day-1",
        durationMin: 90,
        rpe: 9,
        rationale: null,
        source: "structure",
        refined: true,
      });

      // The query cache notifies on a timer, so wait for the re-render.
      await waitFor(() => expect(screen.getByTestId("fuelling-target-chip-entry-1")).toHaveTextContent("61g"));
    });
  });
});
