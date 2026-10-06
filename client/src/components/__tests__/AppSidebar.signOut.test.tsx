import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { clearOfflineQueue, enqueueMutation, getPendingCount } from "@/lib/offlineQueue";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { firstName: "Sam", lastName: "Lee" } }),
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

/** Signed out: sign-out clears the athlete's data from this device, under Clerk or not. */
const SIGNED_IN_MARKER = "fitai-onboarding-complete";
const signedOut = () => localStorage.getItem(SIGNED_IN_MARKER) === null;

function renderSidebar() {
  render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

// CL61 (CODEBASE_ANALYSIS_2026-10-03): Log out cleared queued offline writes
// with no confirmation and no drop toast.
describe("AppSidebar sign-out", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SIGNED_IN_MARKER, "true");
  });

  afterEach(() => {
    clearOfflineQueue();
  });

  it("signs out at once when nothing is waiting to sync", async () => {
    renderSidebar();

    await userEvent.click(screen.getByTestId("button-logout"));

    await waitFor(() => {
      expect(signedOut()).toBe(true);
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the unsynced changes and keeps them when the athlete stays signed in", async () => {
    enqueueMutation("POST", "/api/v1/workouts", { title: "Basement gym" }, { id: "first" });
    enqueueMutation("PATCH", "/api/v1/workouts/w1", { notes: "Felt strong" }, { id: "second" });
    renderSidebar();

    await userEvent.click(screen.getByTestId("button-logout"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2 changes you made offline haven't reached the server yet");
    await userEvent.click(screen.getByTestId("button-cancel-logout"));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(getPendingCount()).toBe(2);
    expect(signedOut()).toBe(false);
  });

  it("signs out and clears the queue once the athlete confirms", async () => {
    enqueueMutation("POST", "/api/v1/workouts", { title: "Basement gym" }, { id: "first" });
    renderSidebar();

    await userEvent.click(screen.getByTestId("button-logout"));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "1 change you made offline hasn't reached the server yet",
    );
    await userEvent.click(screen.getByTestId("button-confirm-logout"));

    await waitFor(() => {
      expect(signedOut()).toBe(true);
    });
    expect(getPendingCount()).toBe(0);
  });
});
