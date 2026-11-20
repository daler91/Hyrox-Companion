import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import type { RegisterSWOptions } from "vite-plugin-pwa/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/toaster";
import { __resetToastStateForTests } from "@/hooks/use-toast";

import { registerServiceWorker } from "./serviceWorkerUpdate";

/**
 * Tech debt #54: the worker registers as "prompt", but onNeedRefresh did
 * nothing, so a waiting build took over only once every tab was closed.
 */
describe("registerServiceWorker", () => {
  afterEach(() => {
    __resetToastStateForTests();
  });

  function registerWithFake() {
    let options: RegisterSWOptions = {};
    const updateServiceWorker = vi.fn(() => Promise.resolve());
    registerServiceWorker((given) => {
      options = given;
      return updateServiceWorker;
    });
    return { needRefresh: () => act(() => options.onNeedRefresh?.()), updateServiceWorker };
  }

  it("offers a reload when a new build is waiting, and Reload hands over to it", () => {
    render(<Toaster />);
    const { needRefresh, updateServiceWorker } = registerWithFake();
    expect(screen.queryByText("A new version is ready")).not.toBeInTheDocument();

    needRefresh();

    expect(screen.getByText("A new version is ready")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toast-reload-update"));
    expect(updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("keeps the prompt up rather than letting it time out", () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      const { needRefresh } = registerWithFake();
      needRefresh();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(screen.getByText("A new version is ready")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
