import { render, screen } from "@testing-library/react";
import { Component, type ReactNode, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChunkLoadError, isChunkLoadError, lazyWithReload } from "./lazyWithReload";

const RELOAD_KEY = "fitai-chunk-reload-at";
// What Chromium throws when a deploy removed the chunk and the server answered
// the old /assets URL with index.html.
const STALE_CHUNK_ERROR = new TypeError(
  "Failed to fetch dynamically imported module: https://app.example/assets/Timeline-0ld.js",
);

const reload = vi.fn();
const originalLocation = globalThis.location;

class CatchError extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="caught">{(this.state.error as Error).name}</div>;
    }
    return this.props.children;
  }
}

function renderRoute(load: () => Promise<{ default: () => ReactNode }>) {
  const Route = lazyWithReload(load);
  return render(
    <CatchError>
      <Suspense fallback={<div data-testid="route-fallback" />}>
        <Route />
      </Suspense>
    </CatchError>,
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}

describe("lazyWithReload (CL3)", () => {
  beforeEach(() => {
    reload.mockReset();
    sessionStorage.clear();
    setOnline(true);
    Object.defineProperty(globalThis, "location", { configurable: true, value: { reload } });
    // React logs the boundary-caught error; keep the output readable.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    setOnline(true);
    vi.restoreAllMocks();
  });

  it("renders the route when its chunk loads", async () => {
    renderRoute(() => Promise.resolve({ default: () => <p>Timeline</p> }));
    expect(await screen.findByText("Timeline")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once onto the current build when a route chunk is gone, keeping the fallback up", async () => {
    renderRoute(() => Promise.reject(STALE_CHUNK_ERROR));

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("route-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("caught")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(RELOAD_KEY)).not.toBeNull();
  });

  it("hands a chunk that still fails after the reload to the error boundary instead of looping", async () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));

    renderRoute(() => Promise.reject(STALE_CHUNK_ERROR));

    expect(await screen.findByTestId("caught")).toHaveTextContent("ChunkLoadError");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again for a later deploy once the window has passed", async () => {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 61_000));

    renderRoute(() => Promise.reject(STALE_CHUNK_ERROR));

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it("does not reload when it cannot record the reload (storage blocked)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    renderRoute(() => Promise.reject(STALE_CHUNK_ERROR));

    expect(await screen.findByTestId("caught")).toHaveTextContent("ChunkLoadError");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload while offline", async () => {
    setOnline(false);

    renderRoute(() => Promise.reject(STALE_CHUNK_ERROR));

    expect(await screen.findByTestId("caught")).toHaveTextContent("ChunkLoadError");
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("isChunkLoadError", () => {
  it.each([
    ["the wrapper's own error", new ChunkLoadError(STALE_CHUNK_ERROR)],
    ["Chromium", STALE_CHUNK_ERROR],
    ["Firefox", new TypeError("error loading dynamically imported module: https://app.example/assets/a.js")],
    ["Safari", new TypeError("Importing a module script failed.")],
    ["Vite's CSS preload", new Error("Unable to preload CSS for /assets/Analytics-0ld.css")],
  ])("recognises %s", (_name, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("leaves ordinary render errors to the boundary's reset", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });
});
