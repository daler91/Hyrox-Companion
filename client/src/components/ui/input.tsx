import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & {
  /**
   * When set, the input renders as invalid: aria-invalid="true" is applied,
   * the error text is rendered below the field and linked via
   * aria-describedby so screen readers announce it on focus (WCAG 3.3.1, W9).
   */
  errorMessage?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, errorMessage, id, "aria-describedby": ariaDescribedBy, ...props }, ref) => {
    const reactId = React.useId()
    const inputId = id ?? reactId
    const errorId = errorMessage ? `${inputId}-error` : undefined
    const describedBy = [ariaDescribedBy, errorId].filter(Boolean).join(" ") || undefined

    // h-9 to match icon buttons and default buttons.
    const inputEl = (
      <input
        id={inputId}
        type={type}
        aria-invalid={errorMessage ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          errorMessage && "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        {...props}
      />
    )

    if (!errorMessage) return inputEl
    return (
      <>
        {inputEl}
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {errorMessage}
        </p>
      </>
    )
  }
)
Input.displayName = "Input"

export { Input }
