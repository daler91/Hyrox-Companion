import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", () => ({
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import Landing from "../Landing";

const AXE_TIMEOUT_MS = 10_000;

// jsdom has no IntersectionObserver; the fade-in hook only needs the constructor.
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("Landing", () => {
  it("features session grading, missed-session recovery and body-system load", () => {
    render(<Landing />);

    for (const title of ["Session Grading", "Missed-Session Recovery", "Load by Body System"]) {
      expect(screen.getByRole("heading", { level: 3, name: new RegExp(`^${title}`) })).toBeTruthy();
    }
    expect(screen.getByText("What happens if I miss a session?")).toBeTruthy();
    expect(screen.getByText("How do I know if a run did its job?")).toBeTruthy();
  });

  it(
    "has no automated WCAG violations",
    async () => {
      const { container } = render(<Landing />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    },
    AXE_TIMEOUT_MS,
  );
});
