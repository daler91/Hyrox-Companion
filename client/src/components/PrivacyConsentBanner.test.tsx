import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

import { PrivacyConsentBanner } from "./PrivacyConsentBanner";

const CONSENT_STORAGE_KEY = "fitai-privacy-consent-v1";

type BlockingLayer = "dialog" | "sheet" | "alert";

function BlockingLayerHarness({ layer }: Readonly<{ layer: BlockingLayer }>) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <PrivacyConsentBanner />
      {layer === "dialog" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Blocking dialog</DialogTitle>
            <DialogDescription>Test dialog description.</DialogDescription>
            <button type="button" onClick={() => setOpen(false)}>
              Close test dialog
            </button>
          </DialogContent>
        </Dialog>
      ) : null}
      {layer === "sheet" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent>
            <SheetTitle>Blocking sheet</SheetTitle>
            <SheetDescription>Test sheet description.</SheetDescription>
            <button type="button" onClick={() => setOpen(false)}>
              Close test sheet
            </button>
          </SheetContent>
        </Sheet>
      ) : null}
      {layer === "alert" ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>Blocking alert</AlertDialogTitle>
            <AlertDialogDescription>Test alert description.</AlertDialogDescription>
            <button type="button" onClick={() => setOpen(false)}>
              Close test alert
            </button>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

describe("PrivacyConsentBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the notice when consent has not been recorded", () => {
    render(<PrivacyConsentBanner />);

    expect(screen.getByLabelText("Privacy notice")).toBeInTheDocument();
    expect(screen.getByText(/We use Sentry for error tracking/)).toBeVisible();
  });

  it("records consent and hides when dismissed", () => {
    render(<PrivacyConsentBanner />);

    fireEvent.click(screen.getByTestId("btn-consent-ack"));

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
    expect(screen.queryByLabelText("Privacy notice")).not.toBeInTheDocument();
  });

  it("records consent and hides when the close button is used", () => {
    render(<PrivacyConsentBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss privacy notice" }));

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
    expect(screen.queryByLabelText("Privacy notice")).not.toBeInTheDocument();
  });

  it.each<BlockingLayer>(["dialog", "sheet", "alert"])(
    "hides while a blocking %s layer is open",
    (layer) => {
      render(<BlockingLayerHarness layer={layer} />);

      expect(screen.queryByLabelText("Privacy notice")).not.toBeInTheDocument();
    },
  );

  it("appears after the blocking layer closes when consent is still missing", async () => {
    render(<BlockingLayerHarness layer="dialog" />);

    fireEvent.click(screen.getByRole("button", { name: "Close test dialog" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Privacy notice")).toBeInTheDocument();
    });
  });

  it("treats denied localStorage as acknowledged consent", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
    });

    render(<PrivacyConsentBanner />);

    expect(screen.queryByLabelText("Privacy notice")).not.toBeInTheDocument();
  });

  it("does not write probe keys when handling storage events", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);

    render(<PrivacyConsentBanner />);

    globalThis.dispatchEvent(new Event("storage"));

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
