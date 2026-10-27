// Offline support for the home-screen app: always try the network first, and
// fall back to the last copy of that page that loaded (the brief shows its own "updated" time).
// The Brief (/) and the CRM (/crm/) are cached separately; CRM data (/api/) is never cached.
const CACHE = "brief-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || req.mode !== "navigate" || url.origin !== location.origin) return;
  const key = url.pathname.startsWith("/crm") ? "/crm/" : "/";
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only a real page (200) is cached, never the sign-in page (401).
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.open(CACHE).then((c) => c.match(key)).then((cached) => cached || Response.error()))
  );
});
