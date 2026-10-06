import { vi } from "vitest";

/**
 * Make the device report `timeZone` from
 * `Intl.DateTimeFormat().resolvedOptions()`, as on a page loaded after a
 * flight. It patches the prototype, so formatters built earlier (the page's
 * `pageTimezone`) report it too. The other options are the default
 * formatter's. Undo with `vi.restoreAllMocks()`.
 */
export function mockDeviceTimezone(timeZone: string) {
  const defaults = new Intl.DateTimeFormat().resolvedOptions();
  return vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ ...defaults, timeZone });
}
