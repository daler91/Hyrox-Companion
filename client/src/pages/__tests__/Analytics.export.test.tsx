import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import Analytics from "../Analytics";

const mocks = vi.hoisted(() => ({
  createObjectURL: vi.fn(),
  exportData: vi.fn(),
  revokeObjectURL: vi.fn(),
  setDateRange: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/components/analytics/CategoryBreakdownTab", () => ({
  CategoryBreakdownTab: () => <div data-testid="category-breakdown-tab" />,
}));
vi.mock("@/components/analytics/CoachInsightsTab", () => ({
  CoachInsightsTab: () => <div data-testid="coach-insights-tab" />,
}));
vi.mock("@/components/analytics/ExerciseProgressionTab", () => ({
  ExerciseProgressionTab: () => <div data-testid="exercise-progression-tab" />,
}));
vi.mock("@/components/analytics/PersonalRecordsTab", () => ({
  PersonalRecordsTab: () => <div data-testid="personal-records-tab" />,
}));
vi.mock("@/components/analytics/TrainingOverviewTab", () => ({
  TrainingOverviewTab: () => <div data-testid="training-overview-tab" />,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    ...props
  }: ComponentProps<"button">) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/hooks/useUrlQueryState", () => ({
  useUrlQueryState: () => ["90", mocks.setDateRange],
}));
vi.mock("@/lib/api", () => ({
  api: {
    analytics: {
      exportData: mocks.exportData,
    },
  },
  QUERY_KEYS: {
    preferences: ["preferences"],
  },
}));

installRadixPointerMocks();

function renderAnalytics() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryDefaults(["preferences"], {
    queryFn: () => Promise.resolve({ weeklyGoal: 5 }),
    staleTime: Infinity,
  });
  queryClient.setQueryData(["preferences"], { weeklyGoal: 5 });
  return render(
    <QueryClientProvider client={queryClient}>
      <Analytics />
    </QueryClientProvider>,
  );
}

function clickExportOption(testId: string) {
  fireEvent.click(screen.getByTestId("button-analytics-export"));
  fireEvent.click(screen.getByTestId(testId));
}

function getTabLabels() {
  return screen
    .getAllByRole("tab")
    .map((tab) => tab.textContent?.replace(/\s+/g, " ").trim());
}

describe("Analytics export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createObjectURL.mockReturnValue("blob:analytics-export");
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
  });

  it("downloads an export blob without navigating away", async () => {
    let resolveExport: (response: Response) => void = () => {};
    mocks.exportData.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveExport = resolve;
      }),
    );
    const clickDownload = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderAnalytics();
    clickExportOption("button-export-analytics-csv");

    expect(mocks.exportData).toHaveBeenCalledWith("csv");
    await waitFor(() => {
      expect(screen.getByTestId("button-analytics-export")).toBeDisabled();
    });
    expect(screen.getByTestId("button-analytics-export")).toHaveTextContent("Exporting...");

    await act(async () => {
      resolveExport(
        {
          blob: () => Promise.resolve(new Blob(["date,title\n2026-05-20,Run"])),
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "content-disposition"
                ? 'attachment; filename="training-export.csv"'
                : null,
          },
        } as Response,
      );
    });

    await waitFor(() => {
      expect(clickDownload).toHaveBeenCalledOnce();
    });
    expect(mocks.createObjectURL).toHaveBeenCalledOnce();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:analytics-export");
    expect(globalThis.location.pathname).not.toBe("/api/v1/export");
  });

  it("shows a destructive toast when export fails", async () => {
    mocks.exportData.mockRejectedValueOnce(new Error("download failed"));

    renderAnalytics();
    clickExportOption("button-export-analytics-json");

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Export failed",
        description: "Could not download your training data. Please try again.",
        variant: "destructive",
      });
    });
    expect(screen.getByTestId("button-analytics-export")).not.toBeDisabled();
  });
});

describe("Analytics tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Breakdown as the second tab", () => {
    renderAnalytics();

    expect(getTabLabels()).toEqual([
      "Overview",
      "Breakdown",
      "Progression",
      "Records",
      "Coach Insights",
    ]);
  });
});
