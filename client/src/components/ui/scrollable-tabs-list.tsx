import * as React from "react"

import { TabsList } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * Wraps a {@link TabsList} so that, when its triggers overflow horizontally on
 * narrow screens, the strip is obviously scrollable: fade gradients appear on
 * whichever edge has hidden content, and they update as the user scrolls.
 *
 * On desktop (sm+) the consumer typically switches the list to a grid, so the
 * fades hide themselves via `sm:hidden` and the scroll tracking becomes a no-op.
 */
const ScrollableTabsList = React.forwardRef<
  React.ElementRef<typeof TabsList>,
  React.ComponentPropsWithoutRef<typeof TabsList>
>(({ className, children, onScroll, ...props }, forwardedRef) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = React.useState(false)
  const [canScrollRight, setCanScrollRight] = React.useState(false)

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      if (typeof forwardedRef === "function") {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef],
  )

  const updateFades = React.useCallback(() => {
    const el = listRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    updateFades()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateFades)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateFades])

  return (
    <div className="relative mb-6">
      <TabsList
        ref={setRefs}
        className={className}
        onScroll={(event) => {
          updateFades()
          onScroll?.(event)
        }}
        {...props}
      >
        {children}
      </TabsList>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-lg bg-gradient-to-r from-muted to-transparent transition-opacity duration-200 sm:hidden",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-muted to-transparent transition-opacity duration-200 sm:hidden",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
})
ScrollableTabsList.displayName = "ScrollableTabsList"

export { ScrollableTabsList }
