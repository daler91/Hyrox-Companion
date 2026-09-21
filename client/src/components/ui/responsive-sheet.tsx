import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface ResponsiveSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly contentClassName?: string;
  readonly mobileFullHeight?: boolean;
  readonly desktopFullHeight?: boolean;
  readonly testId?: string;
}

/** Drag the sheet further than this (px) and let go to close it. */
const SWIPE_DISMISS_PX = 80;
/** Finger travel before a touch on the header counts as a drag, not a tap. */
const SWIPE_START_PX = 8;

/**
 * Swipe-down-to-dismiss for the phone sheet. The handle and header are the
 * grab zone (`touch-none`, so the browser never turns the drag into a scroll)
 * while the body keeps scrolling normally. The move/up listeners live on
 * `window` for the drag's duration instead of using pointer capture, so a tap
 * on a header control (the title's edit pencil) still lands on that control.
 */
function useSwipeToDismiss(
  contentRef: React.RefObject<HTMLDivElement | null>,
  onOpenChange: (open: boolean) => void,
) {
  return React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      const el = contentRef.current;
      if (!el) return;
      const startY = event.clientY;
      let dy = 0;
      let engaged = false;

      const move = (ev: PointerEvent) => {
        dy = ev.clientY - startY;
        if (!engaged) {
          if (dy < SWIPE_START_PX) return;
          engaged = true;
          el.style.transition = "none";
        }
        el.style.transform = `translateY(${Math.max(0, dy)}px)`;
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (!engaged) return;
        if (dy > SWIPE_DISMISS_PX) {
          // Leave the offset in place: Radix's slide-out animation starts
          // from the current transform, so the sheet keeps falling instead of
          // snapping back up before it leaves.
          onOpenChange(false);
          return;
        }
        el.style.transition = "transform 200ms ease-out";
        el.style.transform = "";
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [contentRef, onOpenChange],
  );
}

type SheetChromeProps = Pick<
  ResponsiveSheetProps,
  "open" | "onOpenChange" | "title" | "description" | "children" | "contentClassName" | "testId"
>;

function MobileSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
  testId,
  fullHeight,
}: SheetChromeProps & { readonly fullHeight: boolean }) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const onGrabPointerDown = useSwipeToDismiss(contentRef, onOpenChange);
  const header = (
    <SheetHeader className={fullHeight ? "sr-only" : "shrink-0 text-left"}>
      <SheetTitle>{title}</SheetTitle>
      {description ? <SheetDescription>{description}</SheetDescription> : null}
    </SheetHeader>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={contentRef}
        side="bottom"
        // Focus the sheet container rather than its first control: Radix
        // otherwise lands on the title's edit button, whose tooltip opens on
        // focus and sits over the header on touch screens (no hover to
        // dismiss it). Focus stays inside the dialog for the trap.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className={cn(
          fullHeight
            ? "flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-none p-0"
            // dvh, not vh: with the browser's URL bar showing, 90vh of a
            // phone is taller than the visible area and the bottom of the
            // sheet (usually the primary button) was clipped off-screen.
            : "max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3",
          contentClassName,
        )}
        data-testid={testId}
      >
        {fullHeight ? (
          header
        ) : (
          <div
            className="-mx-4 -mt-3 cursor-grab touch-none select-none px-4 pt-3 active:cursor-grabbing"
            onPointerDown={onGrabPointerDown}
            data-testid="sheet-grab-zone"
          >
            <div
              className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/40"
              aria-hidden="true"
            />
            {header}
          </div>
        )}
        <div className={fullHeight ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "mt-4"}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DesktopDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
  testId,
  fullHeight,
}: SheetChromeProps & { readonly fullHeight: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-lg",
          fullHeight ? "h-[90vh] flex flex-col overflow-hidden" : "max-h-[90vh] overflow-hidden",
          contentClassName,
        )}
        data-testid={testId}
      >
        <DialogHeader className={fullHeight ? "shrink-0" : undefined}>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div
          className={
            fullHeight
              ? "min-h-0 flex-1 flex flex-col overflow-hidden"
              : "max-h-[calc(90vh-7rem)] overflow-y-auto pr-1"
          }
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResponsiveSheet({
  mobileFullHeight = false,
  desktopFullHeight = false,
  ...chrome
}: ResponsiveSheetProps) {
  const isMobile = useIsMobile();
  return isMobile ? (
    <MobileSheet {...chrome} fullHeight={mobileFullHeight} />
  ) : (
    <DesktopDialog {...chrome} fullHeight={desktopFullHeight} />
  );
}
