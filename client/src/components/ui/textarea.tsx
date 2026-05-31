import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  /**
   * When set, the textarea renders as invalid: aria-invalid="true" is applied,
   * the error text is rendered below the field and linked via
   * aria-describedby so screen readers announce it on focus (WCAG 3.3.1, W7).
   * Mirrors the Input error API.
   */
  errorMessage?: string
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, errorMessage, id, "aria-describedby": ariaDescribedBy, ...props }, ref) => {
    const reactId = React.useId()
    const textareaId = id ?? reactId
    const errorId = errorMessage ? `${textareaId}-error` : undefined
    const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined

    const textareaEl = (
      <textarea
        id={textareaId}
        aria-invalid={errorMessage ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          errorMessage && "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        {...props}
      />
    )

    if (!errorMessage) return textareaEl
    return (
      <>
        {textareaEl}
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {errorMessage}
        </p>
      </>
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
