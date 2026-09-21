import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { MobileTabBar } from "../MobileTabBar";

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook}>
      <MobileTabBar />
    </Router>,
  );
}

describe("MobileTabBar", () => {
  it("links every primary destination using the sidebar's test-id convention", () => {
    renderAt("/");

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByTestId("nav-tab-training")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("nav-tab-log-workout")).toHaveAttribute("href", "/log");
    expect(screen.getByTestId("nav-tab-analytics")).toHaveAttribute("href", "/analytics");
    expect(screen.getByTestId("nav-tab-settings")).toHaveAttribute("href", "/settings");
    // The short label is what fits five-across; the full name stays the accessible one.
    expect(screen.getByTestId("nav-tab-log-workout")).toHaveAccessibleName("Log Workout");
    expect(screen.getByTestId("nav-tab-log-workout")).toHaveTextContent("Log");
  });

  it("marks only the current section as the current page", () => {
    renderAt("/analytics");

    expect(screen.getByTestId("nav-tab-analytics")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-tab-training")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("nav-tab-settings")).not.toHaveAttribute("aria-current");
  });

  it("keeps a section lit on its nested routes without lighting Training for everything", () => {
    renderAt("/settings/integrations");

    expect(screen.getByTestId("nav-tab-settings")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-tab-training")).not.toHaveAttribute("aria-current");
  });
});
