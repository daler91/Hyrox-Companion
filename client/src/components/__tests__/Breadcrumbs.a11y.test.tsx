import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { Breadcrumbs } from "../Breadcrumbs";

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => null },
    },
  });
  const { hook } = memoryLocation({ path });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Breadcrumbs />
      </Router>
    </QueryClientProvider>,
  );
}

describe("Breadcrumbs a11y", () => {
  it.each([
    { route: "a secondary route", path: "/log" },
    { route: "Settings", path: "/settings" },
    // Home without a workout id renders nothing: an empty container still has
    // zero violations, so this case asserts the null-render branch doesn't
    // introduce hidden-structure issues.
    { route: "Home without a workout id (renders nothing)", path: "/" },
  ])("has no WCAG violations on $route", async ({ path }) => {
    const { container } = renderAt(path);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
