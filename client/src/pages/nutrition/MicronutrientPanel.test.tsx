import type { MicroSummaryResponse } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { MicronutrientPanel } from "./MicronutrientPanel";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { getMicros: vi.fn() } },
  QUERY_KEYS: { nutritionMicros: (date: string) => ["/api/v1/nutrition/micros", date] },
}));

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = <MicronutrientPanel date="2026-06-07" />;
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("MicronutrientPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a row per micro with its %RDI", async () => {
    const data: MicroSummaryResponse = {
      date: "2026-06-07",
      micros: [{ key: "sodium", label: "Sodium", unit: "mg", amount: 2000, rdi: 2300, pctRdi: 87 }],
    };
    vi.mocked(api.nutrition.getMicros).mockResolvedValue(data);
    renderPanel();

    expect(await screen.findByTestId("micro-sodium")).toHaveTextContent("87%");
    expect(screen.queryByTestId("micro-empty")).not.toBeInTheDocument();
  });

  it("shows the empty state when the day's foods carry no micro data", async () => {
    vi.mocked(api.nutrition.getMicros).mockResolvedValue({ date: "2026-06-07", micros: [] });
    renderPanel();

    expect(await screen.findByTestId("micro-empty")).toBeInTheDocument();
  });
});
