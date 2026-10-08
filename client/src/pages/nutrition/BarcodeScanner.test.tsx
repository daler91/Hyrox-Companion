import type { Food } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { BarcodeScanner } from "./BarcodeScanner";

vi.mock("@/lib/api", () => ({
  api: { nutrition: { lookupBarcode: vi.fn() } },
  QUERY_KEYS: {},
}));

const FOOD = { id: "f1", name: "Nutella" } as Food;

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  // A wrapper, not an outer element, so rerender keeps the client.
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

type Mutable = { BarcodeDetector?: unknown };

describe("BarcodeScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete (globalThis as Mutable).BarcodeDetector;
  });

  it("falls back to manual entry when BarcodeDetector is unavailable", () => {
    renderWithClient(<BarcodeScanner open onClose={vi.fn()} onResolved={vi.fn()} />);
    expect(screen.getByTestId("input-barcode")).toBeInTheDocument();
    expect(screen.getByText(/Live scanning isn't supported/i)).toBeInTheDocument();
  });

  it("resolves a manually entered barcode", async () => {
    vi.mocked(api.nutrition.lookupBarcode).mockResolvedValue(FOOD);
    const onResolved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithClient(<BarcodeScanner open onClose={onClose} onResolved={onResolved} />);

    await user.type(screen.getByTestId("input-barcode"), "3017620422003");
    await user.click(screen.getByTestId("button-barcode-lookup"));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(FOOD));
    expect(api.nutrition.lookupBarcode).toHaveBeenCalledWith("3017620422003");
  });

  it("stops the camera on unmount", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    (globalThis as Mutable).BarcodeDetector = class {
      async detect() {
        return [];
      }
    };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    const { unmount } = renderWithClient(<BarcodeScanner open onClose={vi.fn()} onResolved={vi.fn()} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    unmount();
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  // U32 (CODEBASE_ANALYSIS_2026-10-03): live scanning stopped at the first
  // detection, so after a miss the camera ran but scanned nothing.
  it("keeps scanning after a live-scanned barcode is not recognized", async () => {
    const MISS = "11111111";
    const HIT = "3017620422003";
    let frames = 0;
    (globalThis as Mutable).BarcodeDetector = class {
      async detect() {
        frames += 1;
        return [{ rawValue: frames < 5 ? MISS : HIT }];
      }
    };
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api.nutrition.lookupBarcode).mockImplementation(async (code: string) => {
      if (code === MISS) throw new Error("404: not found");
      return FOOD;
    });
    const onResolved = vi.fn();
    renderWithClient(<BarcodeScanner open onClose={vi.fn()} onResolved={onResolved} />);

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith(FOOD);
    });
    // The unrecognized code is looked up once, not on every frame it stays in view.
    expect(vi.mocked(api.nutrition.lookupBarcode).mock.calls).toEqual([[MISS], [HIT]]);
  });

  it("starts the next open without the previous miss", async () => {
    vi.mocked(api.nutrition.lookupBarcode).mockRejectedValue(new Error("404: not found"));
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithClient(
      <BarcodeScanner open onClose={onClose} onResolved={vi.fn()} />,
    );

    await user.type(screen.getByTestId("input-barcode"), "3017620422003");
    await user.click(screen.getByTestId("button-barcode-lookup"));
    expect(await screen.findByTestId("text-barcode-error")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    rerender(<BarcodeScanner open={false} onClose={onClose} onResolved={vi.fn()} />);
    rerender(<BarcodeScanner open onClose={onClose} onResolved={vi.fn()} />);

    expect(screen.queryByTestId("text-barcode-error")).not.toBeInTheDocument();
  });

  it("shows the camera again on the next open after a camera error", async () => {
    (globalThis as Mutable).BarcodeDetector = class {
      async detect() {
        return [];
      }
    };
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("NotAllowedError"))
      .mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithClient(
      <BarcodeScanner open onClose={onClose} onResolved={vi.fn()} />,
    );

    expect(await screen.findByText(/Couldn't access the camera/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    rerender(<BarcodeScanner open={false} onClose={onClose} onResolved={vi.fn()} />);
    rerender(<BarcodeScanner open onClose={onClose} onResolved={vi.fn()} />);

    const video = await screen.findByLabelText("Barcode scanner camera view");
    await waitFor(() => {
      expect((video as HTMLVideoElement).srcObject).toBe(stream);
    });
    expect(screen.queryByText(/Couldn't access the camera/)).not.toBeInTheDocument();
  });
});
