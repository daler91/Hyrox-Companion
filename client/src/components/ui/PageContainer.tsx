import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export type PageContainerSize = "narrow" | "default" | "form";

interface PageContainerProps extends ComponentPropsWithoutRef<"div"> {
  readonly size?: PageContainerSize;
}

const SIZE_CLASSES: Record<PageContainerSize, string> = {
  narrow: "max-w-2xl",
  default: "max-w-5xl",
  form: "max-w-3xl",
};

export function PageContainer({
  size = "default",
  className,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full p-4 md:p-8", SIZE_CLASSES[size], className)}
      {...props}
    />
  );
}
