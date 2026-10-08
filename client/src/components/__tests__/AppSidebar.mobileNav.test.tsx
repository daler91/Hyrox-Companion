import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { firstName: "Sam", lastName: "Lee" } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));

// U10 (CODEBASE_ANALYSIS_2026-10-03): on phones the sidebar is a modal Sheet
// with a hidden close button, and a nav tap left it covering the new page.
describe("AppSidebar mobile drawer", () => {
  it("closes the drawer after a nav link is tapped", async () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <SidebarProvider>
          <SidebarTrigger data-testid="open-sidebar" />
          <AppSidebar />
        </SidebarProvider>
      </Router>,
    );

    await userEvent.click(screen.getByTestId("open-sidebar"));
    const analyticsLink = await screen.findByRole("link", { name: "Analytics" });

    await userEvent.click(analyticsLink);

    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
    });
  });
});
