import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/queryClient";

import {
  MigrationReviewCallout,
  type MigrationReviewFlag,
  useMigrationReview,
} from "../MigrationReviewCallout";

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return { ...actual, apiRequest: vi.fn() };
});

interface Row {
  readonly ownerId: string;
  readonly status: string;
  readonly reason: string | null;
}

function reviewRows(byOwner: Record<string, Row[]>) {
  const rowsByOwner = new Map(Object.entries(byOwner));
  return vi.fn((url: string) => {
    // The request URL is relative; any base resolves it for reading the query.
    const ownerId = new URL(url, "https://app.test").searchParams.get("ownerId") ?? "";
    const rows = (rowsByOwner.get(ownerId) ?? []).map((row) => ({ ownerType: "workoutLog", ...row }));
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  });
}

const OPEN: Row = { ownerId: "w1", status: "needs_manual_review", reason: "low_confidence_conversion" };

describe("useMigrationReview (U25)", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockResolvedValue(new Response("{}", { status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(apiRequest).mockReset();
  });

  it("shows an open flag and clears it once the athlete answers", async () => {
    vi.stubGlobal("fetch", reviewRows({ w1: [OPEN] }));
    const { result } = renderHook(() => useMigrationReview("w1"));

    await waitFor(() => {
      expect(result.current.reviewFlag?.reason).toBe("low_confidence_conversion");
    });
    await act(() => result.current.resolveReview("accept"));

    expect(result.current.reviewFlag).toBeNull();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts/migration/reviews/resolve",
      { ownerType: "workoutLog", ownerId: "w1", action: "accept" },
    );
  });

  it("records a reject so the same flag does not ask again", async () => {
    vi.stubGlobal("fetch", reviewRows({ w1: [OPEN] }));
    const { result } = renderHook(() => useMigrationReview("w1"));
    await waitFor(() => {
      expect(result.current.reviewFlag).not.toBeNull();
    });

    await act(() => result.current.resolveReview("reject"));

    expect(result.current.reviewFlag).toBeNull();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      "POST",
      "/api/v1/workouts/migration/reviews/resolve",
      { ownerType: "workoutLog", ownerId: "w1", action: "reject", reason: "athlete_rejected" },
    );
  });

  it("does not show resolved, auto-resolved or already-rejected rows", async () => {
    const fetchMock = reviewRows({
      w1: [{ ownerId: "w1", status: "resolved", reason: "auto_resolved" }],
      w2: [{ ownerId: "w2", status: "needs_manual_review", reason: "athlete_rejected" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ id }) => useMigrationReview(id), {
      initialProps: { id: "w1" },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.reviewFlag).toBeNull();

    rerender({ id: "w2" });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(result.current.reviewFlag).toBeNull();
  });

  it("never shows the previous workout's flag on the next workout", async () => {
    vi.stubGlobal("fetch", reviewRows({ w1: [OPEN] }));
    const { result, rerender } = renderHook(({ id }) => useMigrationReview(id), {
      initialProps: { id: "w1" },
    });
    await waitFor(() => {
      expect(result.current.reviewFlag).not.toBeNull();
    });

    rerender({ id: "w2" });

    expect(result.current.reviewFlag).toBeNull();
  });

  it("keeps the flag when the answer fails to save", async () => {
    vi.stubGlobal("fetch", reviewRows({ w1: [OPEN] }));
    vi.mocked(apiRequest).mockRejectedValue(new Error('429: {"error":"Too many requests"}'));
    const { result } = renderHook(() => useMigrationReview("w1"));
    await waitFor(() => {
      expect(result.current.reviewFlag).not.toBeNull();
    });

    await act(async () => {
      await expect(result.current.resolveReview("accept")).rejects.toThrow();
    });

    expect(result.current.reviewFlag).not.toBeNull();
  });
});

describe("MigrationReviewCallout (U25)", () => {
  const flag: MigrationReviewFlag = { ownerId: "w1", status: "needs_manual_review", reason: "parse_returned_no_rows" };

  it("explains the flag in plain words instead of status and reason codes", () => {
    render(<MigrationReviewCallout reviewFlag={flag} onResolveReview={vi.fn()} />);
    const callout = screen.getByTestId("migration-review-callout");

    expect(callout).toHaveTextContent("Check the converted exercises");
    expect(callout).toHaveTextContent("We couldn't find any exercises in this workout's text.");
    expect(callout).not.toHaveTextContent("needs_manual_review");
    expect(callout).not.toHaveTextContent("parse_returned_no_rows");
  });

  it("shows a readable error when the answer fails to save", async () => {
    const onResolveReview = vi.fn(() => Promise.reject(new Error('404: {"error":"Migration review target not found","code":"NOT_FOUND"}')));
    render(<MigrationReviewCallout reviewFlag={flag} onResolveReview={onResolveReview} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Looks right" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save your answer: Migration review target not found",
    );
    expect(screen.getByRole("button", { name: "Looks right" })).toBeEnabled();
  });
});
