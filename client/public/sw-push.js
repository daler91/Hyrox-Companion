/* eslint-disable no-undef, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
// Push notification service worker logic.
//
// Loaded via importScripts() from the generated Workbox service worker (see the
// workbox.importScripts option in vite.config.ts) rather than registered
// separately: two registrations at the default scope "/" would replace one
// another, so push delivery and offline caching could not both be live.

/**
 * Resolve a push-supplied path to a same-origin URL, falling back to "/".
 *
 * `data.url` arrives in the push payload. Payloads are VAPID-signed and
 * server-originated, so this is defence in depth rather than a live hole — but
 * `clients.openWindow()` will happily open any https: URL, so a compromised
 * signing key or a server-side injection would turn a notification tap into a
 * navigation to an attacker's page carrying our branding. Constrain it here,
 * where the cost is one URL parse.
 */
function toSameOriginUrl(rawUrl) {
  const fallback = new URL("/", globalThis.location.origin);
  if (typeof rawUrl !== "string" || rawUrl === "") return fallback.href;
  try {
    const resolved = new URL(rawUrl, globalThis.location.origin);
    return resolved.origin === globalThis.location.origin ? resolved.href : fallback.href;
  } catch {
    return fallback.href;
  }
}

globalThis.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "fitai.coach";
  const options = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    // Normalize at receipt so a bad URL never reaches the click handler.
    data: { url: toSameOriginUrl(data.url) },
  };

  event.waitUntil(globalThis.registration.showNotification(title, options));
});

globalThis.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = toSameOriginUrl(event.notification.data?.url);

  event.waitUntil(
    globalThis.clients.matchAll({ type: "window" }).then((clientList) => {
      // Focus an existing tab if one is open. `startsWith` rather than
      // `includes`: a substring test would match a foreign URL that merely
      // mentions our origin somewhere in its path or query.
      for (const client of clientList) {
        if (client.url.startsWith(`${globalThis.location.origin}/`) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new tab.
      return globalThis.clients.openWindow(url);
    }),
  );
});
