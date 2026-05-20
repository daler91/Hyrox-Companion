import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import TimelineFilters from "../timeline-filters";

// Mock GeneratePlanDialog to avoid requiring QueryClientProvider in tests
vi.mock("@/components/plans/GeneratePlanDialog", () => ({
  GeneratePlanDialog: () => null,
}));

installRadixPointerMocks();

const SELECT_TIMEOUT_MS = 10_000;

describe("TimelineFilters", () => {
  const defaultProps = {
    plans: [
      {
        id: "plan-1",
        name: "Beginner Hyrox",
        totalWeeks: 8,
        createdAt: new Date().toISOString(),
        userId: "user-1",
        updatedAt: null,
        sourceFileName: null,
        goal: null,
        startDate: null,
        endDate: null,
      },
      {
        id: "plan-2",
        name: "Advanced Prep",
        totalWeeks: 12,
        createdAt: new Date().toISOString(),
        userId: "user-1",
        updatedAt: null,
        sourceFileName: null,
        goal: null,
        startDate: null,
        endDate: null,
      },
    ],
    plansLoading: false,
    selectedPlanId: "plan-1",
    onPlanChange: vi.fn(),
    filterStatus: "all" as const,
    onFilterChange: vi.fn(),
    onFileUpload: vi.fn(),
    isImporting: false,
    onRenamePlan: vi.fn(),
    isRenaming: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state for plans", () => {
    render(<TimelineFilters {...defaultProps} plansLoading={true} plans={[]} />);
    expect(screen.getByText("Loading plans...")).toBeInTheDocument();
    expect(screen.queryByTestId("select-plan")).not.toBeInTheDocument();
  });

  it("renders empty state when there are no plans", () => {
    render(<TimelineFilters {...defaultProps} plans={[]} />);
    expect(screen.getByText("No plans yet")).toBeInTheDocument();
  });

  it("renders plan selector with correct default value", () => {
    render(<TimelineFilters {...defaultProps} />);
    expect(screen.getByTestId("select-plan")).toBeInTheDocument();
    expect(screen.getByTestId("button-rename-plan")).toBeInTheDocument();
  });

  it("triggers onPlanChange when a new plan is selected", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    const selectTrigger = screen.getByTestId("select-plan");
    await user.click(selectTrigger);

    // Radix UI renders SelectContent in a portal, wait for it
    const plan2Option = await screen.findByRole("option", { name: "Advanced Prep (12 weeks)" });
    await user.click(plan2Option);

    expect(defaultProps.onPlanChange).toHaveBeenCalledWith("plan-2");
  }, SELECT_TIMEOUT_MS);

  it("triggers onPlanChange with null when 'All Plans' is selected", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    const selectTrigger = screen.getByTestId("select-plan");
    await user.click(selectTrigger);

    const allPlansOption = await screen.findByRole("option", { name: "All Plans" });
    await user.click(allPlansOption);

    expect(defaultProps.onPlanChange).toHaveBeenCalledWith(null);
  }, SELECT_TIMEOUT_MS);

  it("triggers onFilterChange when a new status is selected", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    const selectTrigger = screen.getByTestId("select-filter");
    await user.click(selectTrigger);

    const completedOption = await screen.findByRole("option", { name: "Completed" });
    await user.click(completedOption);

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith("completed");
  });

  it("handles CSV download template", async () => {
    const user = userEvent.setup();

    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const mockRevokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      writable: true,
      value: mockCreateObjectURL,
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      writable: true,
      value: mockRevokeObjectURL,
    });

    const originalCreateElement = document.createElement.bind(document);
    const mockClick = vi.fn();
    const mockRemove = vi.fn();

    const mockCreateElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === "a") {
          element.click = mockClick;
          element.remove = mockRemove;
        }
        return element;
      });

    render(<TimelineFilters {...defaultProps} />);

    await user.click(screen.getByTestId("button-plan-tools"));

    const downloadBtn = await screen.findByTestId("button-download-template");
    await user.click(downloadBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockCreateElement).toHaveBeenCalledWith("a");
    expect(mockClick).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    mockCreateElement.mockRestore();
  });

  it("triggers onFileUpload when a CSV is uploaded", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    const file = new File(["test"], "test.csv", { type: "text/csv" });
    const input = screen.getByTestId("input-csv-upload");

    await user.upload(input, file);

    expect(defaultProps.onFileUpload).toHaveBeenCalled();
  });

  it("shows loader when importing", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} isImporting={true} />);

    await user.click(screen.getByTestId("button-plan-tools"));

    const importItem = await screen.findByTestId("button-import-plan");

    expect(importItem).toHaveAttribute("data-disabled");
    expect(importItem.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("handles renaming a plan", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    const renameBtn = screen.getByTestId("button-rename-plan");
    await user.click(renameBtn);

    expect(await screen.findByText("Rename Training Plan")).toBeInTheDocument();

    const input = await screen.findByTestId("input-rename-plan");
    expect(input).toHaveValue("Beginner Hyrox");

    fireEvent.change(input, { target: { value: "Super Beginner Hyrox" } });

    const submitBtn = await screen.findByTestId("button-rename-submit");
    await user.click(submitBtn);

    await waitFor(() => {
      expect(defaultProps.onRenamePlan).toHaveBeenCalledWith("plan-1", "Super Beginner Hyrox");
    });
  });

  it("disables save button when rename input is empty or just spaces", async () => {
    const user = userEvent.setup();
    render(<TimelineFilters {...defaultProps} />);

    await user.click(screen.getByTestId("button-rename-plan"));

    const input = await screen.findByTestId("input-rename-plan");
    await user.clear(input);
    await user.type(input, "   "); // Just spaces

    const submitBtn = await screen.findByTestId("button-rename-submit");
    expect(submitBtn).toBeDisabled();
  });

  it("shows loader and disables save button when isRenaming is true", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TimelineFilters {...defaultProps} />);

    await user.click(screen.getByTestId("button-rename-plan"));

    rerender(<TimelineFilters {...defaultProps} isRenaming={true} />);

    const submitBtn = await screen.findByTestId("button-rename-submit");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
