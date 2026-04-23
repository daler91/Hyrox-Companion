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
  it("has no WCAG violations on a secondary route", async () => {
    const { container } = renderAt("/log");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no WCAG violations on Settings", async () => {
    const { container } = renderAt("/settings");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("renders nothing (empty container) on Home without a workout id", async () => {
    const { container } = renderAt("/");
    // Empty containers still have zero violations; this asserts the null-render
    // branch doesn't introduce hidden-structure issues.
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
