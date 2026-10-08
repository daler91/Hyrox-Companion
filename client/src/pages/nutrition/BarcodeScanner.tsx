import type { Food } from "@shared/schema";
import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
/** tick catches its own detect errors, so a rejection here has nothing left to report. */
function ignoreTickError(): undefined {
  return undefined;
}

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
  /** The live-scanned code the server last failed to recognize. */
  const rejectedCodeRef = useRef<string | null>(null);
  /** Restarts the detect loop after a live-scan lookup misses; null when no loop is paused. */
  const resumeScanRef = useRef<(() => void) | null>(null);
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

  // A miss and a camera error belong to this visit: the next open starts clean
  // instead of showing a stale "Barcode not recognized", and with the camera
  // view rendered so a stream is never left running with no video.
  // U32 (CODEBASE_ANALYSIS_2026-10-03)
  const closeScanner = () => {
    stopCamera();
    lookup.reset();
    setScanError(null);
    rejectedCodeRef.current = null;
    onClose();
  };

  const resolve = (code: string) => {
    lookup.mutate(code, {
      onSuccess: (food) => {
        onResolved(food);
        closeScanner();
      },
      onError: () => {
        // Live scanning paused for this lookup; keep scanning after a miss,
        // without looking the same unrecognized code up again. U32
        rejectedCodeRef.current = code;
        resumeScanRef.current?.();
      },
    });
  };

  useEffect(() => {
    if (!open || !detectorAvailable) return undefined;
    const Ctor = getBarcodeDetector();
    if (!Ctor) return undefined;
    const detector = new Ctor({ formats: FORMATS });
    let cancelled = false;
    let pausedForLookup = false;

    async function tick() {
      if (cancelled || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const first = codes[0]?.rawValue;
        if (first && BARCODE_RE.test(first) && first !== rejectedCodeRef.current) {
          pausedForLookup = true;
          resolve(first);
          return;
        }
      } catch {
        // transient detect error (e.g. frame not ready) — keep polling
      }
      rafRef.current = requestAnimationFrame(scheduleNextFrame);
    }
    // tick catches its own detect errors; nothing else can reject.
    function scheduleNextFrame() {
      tick().catch(ignoreTickError);
    }
    resumeScanRef.current = () => {
      if (cancelled || !pausedForLookup) return;
      pausedForLookup = false;
      rafRef.current = requestAnimationFrame(scheduleNextFrame);
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
        if (!video) {
          // Nothing to show it in: never leave the camera running unseen. U32
          for (const track of stream.getTracks()) track.stop();
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        rafRef.current = requestAnimationFrame(scheduleNextFrame);
      } catch {
        setScanError("Couldn't access the camera — enter the barcode number instead.");
      }
    };
    void start();

    return () => {
      cancelled = true;
      resumeScanRef.current = null;
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
        if (!o) closeScanner();
      }}
    >
      <DialogContent data-testid="dialog-barcode">
        <DialogHeader>
          <DialogTitle>Scan a barcode</DialogTitle>
          <DialogDescription className="sr-only">
            Use your camera or enter a barcode number to look up a food
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {detectorAvailable && !scanError && (
            <div className="overflow-hidden rounded-md border bg-black">
              <video
                ref={videoRef}
                className="aspect-video w-full object-cover"
                muted
                playsInline
                aria-label="Barcode scanner camera view"
              />
            </div>
          )}
          {scanError && <p className="text-sm text-muted-foreground">{scanError}</p>}
          {!detectorAvailable && (
            <p className="text-sm text-muted-foreground">
              Live scanning isn't supported here — enter the barcode number below.
            </p>
          )}

          <ManualBarcodeForm
            code={manualCode}
            onCodeChange={setManualCode}
            onSubmit={handleManualSubmit}
            isPending={lookup.isPending}
          />

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

interface ManualBarcodeFormProps {
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  readonly onSubmit: (e: FormEvent) => void;
  readonly isPending: boolean;
}

function ManualBarcodeForm({ code, onCodeChange, onSubmit, isPending }: ManualBarcodeFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-1.5">
      <Label htmlFor="barcode-input">Barcode number</Label>
      <div className="flex gap-2">
        <Input
          id="barcode-input"
          inputMode="numeric"
          pattern="\d*"
          placeholder="e.g. 3017620422003"
          enterKeyHint="go"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          data-testid="input-barcode"
        />
        <Button
          type="submit"
          className="shrink-0"
          disabled={isPending || !BARCODE_RE.test(code.trim())}
          data-testid="button-barcode-lookup"
        >
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
          {isPending ? "Looking up…" : "Look up"}
        </Button>
      </div>
    </form>
  );
}
