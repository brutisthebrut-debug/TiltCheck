/**
 * TiltCheck Service Worker — handles web push notifications.
 * Receives push payloads from the server and displays OS-level notifications
 * with a deep-link back to the relevant app page.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "TiltCheck", body: event.data.text(), url: "/" };
  }

  const { title = "TiltCheck", body = "", url = "/", icon, badge } = payload;

  const options = {
    body,
    icon: icon ?? "/favicon.svg",
    badge: badge ?? "/favicon.svg",
    data: { url },
    requireInteraction: false,
    tag: payload.tag ?? "tiltcheck-notification",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing window if one is already open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Subscription expired — re-subscribe automatically
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true })
      .then((subscription) => {
        // Post back to the page to re-register the new subscription
        return self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((c) =>
            c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription })
          );
        });
      })
  );
});
