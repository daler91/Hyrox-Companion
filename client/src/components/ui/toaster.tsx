import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { TOAST_DURATION_MS } from "@/hooks/constants"
import { useToast } from "@/hooks/use-toast"

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
            duration={duration ?? TOAST_DURATION_MS}
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
