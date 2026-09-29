// Offline support for the home-screen app: always try the network first, and
// fall back to the last dashboard that loaded (it shows its own "updated" time).
const CACHE = "brief-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate" || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only a real dashboard (200) is cached, never the sign-in page (401).
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
        }
        return res;
      })
      .catch(() => caches.match("/").then((cached) => cached || Response.error()))
  );
});
