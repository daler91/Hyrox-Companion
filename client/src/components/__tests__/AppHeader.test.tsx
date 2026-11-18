import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "@/components/AppHeader";
import { SidebarProvider } from "@/components/ui/sidebar";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/brand/Logo", () => ({ Logo: () => null }));

/**
 * Tech debt #52: Ctrl/Cmd+B hides the desktop sidebar and a cookie keeps it
 * hidden for a week, but the only toggle sat in a header hidden from md up,
 * so on desktop nothing on screen could bring the sidebar back.
 */
describe("AppHeader on desktop", () => {
  it("stays hidden from md up while the sidebar is open", () => {
    render(
      <SidebarProvider defaultOpen>
        <AppHeader />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("app-header")).toHaveClass("md:hidden");
  });

  it("shows from md up while the sidebar is collapsed, with a toggle that reopens it", async () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <AppHeader />
      </SidebarProvider>,
    );

    const header = screen.getByTestId("app-header");
    expect(header).not.toHaveClass("md:hidden");

    await userEvent.click(screen.getByTestId("button-sidebar-toggle"));

    expect(header).toHaveClass("md:hidden");
  });

  it("comes back when the keyboard shortcut collapses the sidebar", async () => {
    render(
      <SidebarProvider defaultOpen>
        <AppHeader />
      </SidebarProvider>,
    );

    await userEvent.keyboard("{Control>}b{/Control}");

    expect(screen.getByTestId("app-header")).not.toHaveClass("md:hidden");
  });
});
