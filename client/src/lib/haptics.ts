/**
 * A short vibration for confirming a physical-feeling action on a phone
 * (marking a session done, saving a workout). Android Chrome honours the
 * Vibration API; iOS Safari and desktops ignore it, so this is always a
 * no-op-safe enhancement rather than feedback anything relies on.
 */
export function haptic(pattern: number | readonly number[] = 12): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    navigator.vibrate(pattern as number | number[]);
  } catch {
    // Some browsers throw when vibration is blocked by a permissions policy.
  }
}
