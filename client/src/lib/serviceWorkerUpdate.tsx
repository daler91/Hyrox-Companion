import type { RegisterSWOptions } from "vite-plugin-pwa/types";

import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";

/** `registerSW` from `virtual:pwa-register`, passed in so tests can stand in for it. */
export type RegisterServiceWorker = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

/**
 * Registers the service worker and asks the athlete to reload when a new build
 * is waiting.
 *
 * The worker registers with `registerType: "prompt"` (vite.config.ts), so a new
 * build waits until it is told to take over. `onNeedRefresh` used to do
 * nothing, so it took over only once every tab was closed, and a tab left open
 * kept running the old build (tech debt #54). Now a toast offers Reload, which
 * tells the waiting worker to take over and reloads the page onto it.
 *
 * The toast stays until it is used or dismissed. One toast shows at a time, so
 * a later one replaces it; the prompt then comes back on the next load, since
 * the new build is still waiting.
 */
export function registerServiceWorker(register: RegisterServiceWorker): void {
  const updateServiceWorker = register({
    onNeedRefresh() {
      toast({
        title: "A new version is ready",
        description: "Reload to start using it.",
        duration: Number.POSITIVE_INFINITY,
        action: (
          <ToastAction
            altText="Reload to use the new version"
            onClick={() => {
              void updateServiceWorker();
            }}
            data-testid="toast-reload-update"
          >
            Reload
          </ToastAction>
        ),
      });
    },
  });
}
