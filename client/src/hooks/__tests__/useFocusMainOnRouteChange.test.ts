import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFocusMainOnRouteChange } from "../useFocusMainOnRouteChange";

// Drive wouter's location from the test so we can simulate a navigation.
const locationRef = { current: "/" };
vi.mock("wouter", () => ({
  useLocation: () => [locationRef.current, vi.fn()],
}));

describe("useFocusMainOnRouteChange", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    locationRef.current = "/";
  });

  it("skips the first render, then focuses #main-content on route change", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);

    const { rerender } = renderHook(() => useFocusMainOnRouteChange());
    // Initial mount must not steal focus from the skip-to-content link.
    expect(document.activeElement).not.toBe(main);

    locationRef.current = "/analytics";
    rerender();
    expect(document.activeElement).toBe(main);
  });

  it("does not throw when #main-content is absent", () => {
    const { rerender } = renderHook(() => useFocusMainOnRouteChange());
    locationRef.current = "/settings";
    expect(() => rerender()).not.toThrow();
  });
});
