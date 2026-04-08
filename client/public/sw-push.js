/* eslint-disable no-undef, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
// Push notification service worker
// Registered alongside the Workbox PWA service worker for handling push events.

globalThis.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "fitai.coach";
  const options = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url || "/" },
  };

  event.waitUntil(globalThis.registration.showNotification(title, options));
});

globalThis.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    globalThis.clients.matchAll({ type: "window" }).then((clientList) => {
      // Focus an existing tab if one is open
      for (const client of clientList) {
        if (client.url.includes(globalThis.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return globalThis.clients.openWindow(url);
    }),
  );
});
