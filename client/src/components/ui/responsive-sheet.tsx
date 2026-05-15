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
  readonly testId?: string;
}

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
  mobileFullHeight = false,
  testId,
}: ResponsiveSheetProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            mobileFullHeight
              ? "flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-none p-0"
              : "max-h-[90vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-5",
            contentClassName,
          )}
          data-testid={testId}
        >
          {mobileFullHeight ? null : (
            <div
              className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/40"
              aria-hidden="true"
            />
          )}
          <SheetHeader className={cn("shrink-0 text-left", mobileFullHeight && "sr-only")}>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className={mobileFullHeight ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "mt-4"}>
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("sm:max-w-lg max-h-[90vh] overflow-hidden", contentClassName)}
        data-testid={testId}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="max-h-[calc(90vh-7rem)] overflow-y-auto pr-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
