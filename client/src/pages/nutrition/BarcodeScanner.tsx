import type { Food } from "@shared/schema";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBarcodeLookup } from "@/hooks/useNutrition";

// Minimal typing for the (non-standard-lib) BarcodeDetector API.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const BARCODE_RE = /^\d{8,14}$/;

/**
 * Barcode capture (FR-2.1). Live camera scanning via the native BarcodeDetector
 * where supported (Android/Chrome); a manual numeric entry is ALWAYS available
 * (the only path on iOS Safari / Firefox). Both resolve via the server's
 * /foods/barcode → Open Food Facts. The camera is torn down on resolve/close.
 */
export function BarcodeScanner({
  open,
  onClose,
  onResolved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onResolved: (food: Food) => void;
}) {
  const lookup = useBarcodeLookup();
  const [manualCode, setManualCode] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorAvailable = getBarcodeDetector() !== null;

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const resolve = (code: string) => {
    lookup.mutate(code, {
      onSuccess: (food) => {
        stopCamera();
        onResolved(food);
        onClose();
      },
    });
  };

  useEffect(() => {
    if (!open || !detectorAvailable) return;
    const Ctor = getBarcodeDetector();
    if (!Ctor) return;
    const detector = new Ctor({ formats: FORMATS });
    let cancelled = false;

    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const first = codes[0]?.rawValue;
        if (first && BARCODE_RE.test(first)) {
          resolve(first);
          return;
        }
      } catch {
        // transient detect error (e.g. frame not ready) — keep polling
      }
      rafRef.current = requestAnimationFrame(() => void tick());
    };

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        setScanError("Couldn't access the camera — enter the barcode number instead.");
      }
    };
    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // resolve/stopCamera are stable enough for this lifecycle; re-running only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detectorAvailable]);

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (BARCODE_RE.test(code)) resolve(code);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          stopCamera();
          onClose();
        }
      }}
    >
      <DialogContent data-testid="dialog-barcode">
        <DialogHeader>
          <DialogTitle>Scan a barcode</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {detectorAvailable && !scanError && (
            <div className="overflow-hidden rounded-md border bg-black">
              <video
                ref={videoRef}
                className="aspect-video w-full object-cover"
                muted
                playsInline
              />
            </div>
          )}
          {scanError && <p className="text-sm text-muted-foreground">{scanError}</p>}
          {!detectorAvailable && (
            <p className="text-sm text-muted-foreground">
              Live scanning isn't supported here — enter the barcode number below.
            </p>
          )}

          <form onSubmit={handleManualSubmit} className="space-y-1.5">
            <Label htmlFor="barcode-input">Barcode number</Label>
            <div className="flex gap-2">
              <Input
                id="barcode-input"
                inputMode="numeric"
                pattern="\d*"
                placeholder="e.g. 3017620422003"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                data-testid="input-barcode"
              />
              <Button
                type="submit"
                className="shrink-0"
                disabled={lookup.isPending || !BARCODE_RE.test(manualCode.trim())}
                data-testid="button-barcode-lookup"
              >
                Look up
              </Button>
            </div>
          </form>

          {lookup.isError && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-barcode-error">
              Barcode not recognized.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
