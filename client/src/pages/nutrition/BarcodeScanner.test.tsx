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
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
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
});
