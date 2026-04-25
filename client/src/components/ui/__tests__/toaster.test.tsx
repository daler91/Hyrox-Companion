import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS } from "@/hooks/constants";

import { Toaster } from "../toaster";

type ToastVariant = "default" | "destructive";

interface MockToast {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastRootProps {
  variant?: ToastVariant;
  type?: "background" | "foreground";
  duration?: number;
}

const mocks = vi.hoisted(() => ({
  toastProps: [] as Array<Record<string, unknown>>,
  useToast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: mocks.useToast,
}));

vi.mock("@/components/ui/toast", () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="toast-provider">{children}</div>
  ),
  ToastViewport: () => <div data-testid="toast-viewport" />,
  ToastTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToastDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToastClose: () => <button type="button" aria-label="Close toast" />,
  Toast: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => {
    mocks.toastProps.push(props);
    return <div data-testid="toast-root">{children}</div>;
  },
}));

function renderToasterWith(toast: MockToast) {
  mocks.useToast.mockReturnValue({ toasts: [toast] });
  render(<Toaster />);
  return mocks.toastProps[0] as ToastRootProps;
}

describe("Toaster", () => {
  beforeEach(() => {
    mocks.toastProps.length = 0;
    mocks.useToast.mockReset();
  });

  it("uses the shared 5-second duration for default toasts", () => {
    const props = renderToasterWith({
      id: "default-toast",
      title: "Saved",
      variant: "default",
    });

    expect(props).toMatchObject({
      duration: TOAST_DURATION_MS,
      type: "background",
      variant: "default",
    });
  });

  it("uses the shared 5-second duration for destructive toasts", () => {
    const props = renderToasterWith({
      id: "destructive-toast",
      title: "Save failed",
      variant: "destructive",
    });

    expect(props).toMatchObject({
      duration: TOAST_DURATION_MS,
      type: "foreground",
      variant: "destructive",
    });
  });

  it("keeps explicit toast durations", () => {
    const props = renderToasterWith({
      id: "custom-duration-toast",
      title: "Back online",
      duration: 10_000,
    });

    expect(props.duration).toBe(10_000);
  });
});
