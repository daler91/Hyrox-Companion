import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"

// Default 5s applies to non-destructive toasts (Radix default).
// Destructive toasts persist until the user dismisses them so error
// messages aren't missed by slow readers / AT users — WCAG 2.2.1.
//
// Use the 32-bit signed int max (~24.8 days) rather than Infinity, since
// Radix schedules auto-dismiss via setTimeout and browsers clamp timer
// delays to 32 bits — Infinity overflows to 0ms and would dismiss
// immediately, defeating the whole point.
const PERSISTENT_DURATION = 2_147_483_647

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, duration, ...props }) {
        const isDestructive = variant === "destructive"
        return (
          <Toast
            key={id}
            variant={variant}
            // Destructive: 'foreground' = role=alert / aria-live=assertive in Radix,
            // so screen readers interrupt with the error.
            // Non-destructive: 'background' = role=status / aria-live=polite.
            type={isDestructive ? "foreground" : "background"}
            duration={duration ?? (isDestructive ? PERSISTENT_DURATION : undefined)}
            {...props}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
