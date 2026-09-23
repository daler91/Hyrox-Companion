import { ToastAction, type ToastActionElement } from "@/components/ui/toast";

/**
 * "Connect a device" on the toasts that end onboarding. Setup never mentioned
 * connecting Strava or Garmin, the step most likely to bring an athlete back in
 * week one (onboarding audit L7).
 */
export function connectDeviceToastAction(onConnect: () => void): ToastActionElement {
  return (
    <ToastAction
      altText="Connect Strava or Garmin in Settings"
      onClick={onConnect}
      data-testid="toast-connect-device"
    >
      Connect a device
    </ToastAction>
  );
}
