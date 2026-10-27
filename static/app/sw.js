// Home-screen app: offline copy of the last pages that loaded, and phone notifications.
// Pages: network first, falling back to the last copy (the CRM keeps its own data cache on the device).
// CRM data (/api/) is never cached here.
const CACHE = "crm-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

const SHELL = /^\/crm\/(core|sheets|views|admin|market)\.js$|^\/crm\/(crm|base)\.css$|^\/market\/(fragment\.html|brief\.json)$/;
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isPage = req.mode === "navigate";
  if (!isPage && !SHELL.test(url.pathname)) return;
  const key = isPage ? (url.pathname.startsWith("/brief") ? "/brief/" : "/") : url.pathname;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only real content (200) is kept, never the sign-in page (401).
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.open(CACHE).then((c) => c.match(key)).then((hit) => hit || Response.error()))
  );
});

// Phone notifications sent by the CRM (inbound leads, meetings, due tasks, morning plan).
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "Sanjay Ram CRM", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "Sanjay Ram CRM", {
    body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (new URL(w.url).origin === self.location.origin) { w.focus(); return w.navigate(url); }
    return self.clients.openWindow(url);
  }));
});
