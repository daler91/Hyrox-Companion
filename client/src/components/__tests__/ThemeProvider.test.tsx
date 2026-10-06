import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/components/ThemeProvider";

/** jsdom has no matchMedia; the provider only reads `matches`. */
function stubSystemTheme(prefersDark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: prefersDark && query.includes("dark"),
  }));
}

function ThemeReadout() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

function renderProvider() {
  render(
    <ThemeProvider>
      <ThemeReadout />
    </ThemeProvider>,
  );
}

const rootClasses = () => document.documentElement.classList;

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    rootClasses().remove("light", "dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // CL60 (CODEBASE_ANALYSIS_2026-10-03): with site data blocked, reading
  // `localStorage` throws. The provider wraps every route, the landing page
  // included, so a throw here put the error boundary in its place.
  it("renders its children and follows the system theme when storage is blocked", async () => {
    stubSystemTheme(true);
    const blocked = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    renderProvider();

    expect(blocked).toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: "dark" });
    expect(rootClasses().contains("dark")).toBe(true);

    await userEvent.click(toggle);

    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
    expect(rootClasses().contains("light")).toBe(true);
  });

  it("prefers the stored theme and stores each change", async () => {
    stubSystemTheme(true);
    localStorage.setItem("theme", "light");

    renderProvider();
    await userEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("ignores a stored value that is not a theme", () => {
    stubSystemTheme(false);
    localStorage.setItem("theme", "sepia");

    renderProvider();

    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
    expect(rootClasses().contains("sepia")).toBe(false);
  });
});
