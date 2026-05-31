import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { installRadixPointerMocks } from "@/test/support/radixPointerMocks";

import { ProgressTab } from "../ProgressTab";

vi.mock("@/components/analytics/PersonalRecordsTab", () => ({
  PersonalRecordsTab: ({ dateParams }: { dateParams: string }) => (
    <div data-testid="personal-records-tab">records:{dateParams}</div>
  ),
}));
vi.mock("@/components/analytics/ExerciseProgressionTab", () => ({
  ExerciseProgressionTab: ({ dateParams }: { dateParams: string }) => (
    <div data-testid="exercise-progression-tab">progression:{dateParams}</div>
  ),
}));

installRadixPointerMocks();

describe("ProgressTab", () => {
  it("shows the Records view by default and forwards dateParams", () => {
    render(<ProgressTab dateParams="?from=2024-01-01" />);

    expect(screen.getByTestId("personal-records-tab")).toHaveTextContent(
      "records:?from=2024-01-01",
    );
    expect(screen.queryByTestId("exercise-progression-tab")).not.toBeInTheDocument();
  });

  it("switches to the Progression view when the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<ProgressTab dateParams="?from=2024-01-01" />);

    await user.click(screen.getByTestId("subtab-progression"));

    expect(screen.getByTestId("exercise-progression-tab")).toHaveTextContent(
      "progression:?from=2024-01-01",
    );
    expect(screen.queryByTestId("personal-records-tab")).not.toBeInTheDocument();
  });
});
