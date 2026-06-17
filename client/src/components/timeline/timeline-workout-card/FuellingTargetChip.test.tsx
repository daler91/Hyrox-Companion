import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";

import { FuellingTargetChip } from "./FuellingTargetChip";

vi.mock("@/lib/api", () => ({
  QUERY_KEYS: { preferences: ["/api/v1/preferences"] },
}));

type Blocks = TimelineEntry["structureBlocks"];

function makeEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-06-10",
    type: "planned",
    status: "planned",
    focus: "Strength",
    mainWorkout: "5x5 squat",
    accessory: null,
    notes: null,
    planDayId: "day-1",
    ...over,
  };
}

function renderWithClient(ui: ReactNode, bodyweightKg: number | null = 75) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (bodyweightKg !== null) {
    queryClient.setQueryData(QUERY_KEYS.preferences, { bodyweightKg });
  }
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
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
});
