// Password gate for the whole dashboard (Cloudflare Pages Function, free plan, no card).
// The password is the Pages secret DASHBOARD_PASSWORD, copied from GitHub Secrets on each deploy.
// Signing in sets a cookie for 90 days on that device; changing the password signs everyone out.

const COOKIE = "mdash";
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days, so the home-screen app rarely asks again
const enc = new TextEncoder();
const PUBLIC = new Set(["/health.json", "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png",
  "/icon-512.png", "/sw.js", "/robots.txt"]);

async function tokenFor(password) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("mdash-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function loginPage(message, status = 401) {
  const note = message ? `<p class="err" role="alert">${message}</p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0d0d0d"><title>Morning Brief · sign in</title>
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Brief">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d0d; color: #fff;
         font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: min(340px, calc(100vw - 32px)); background: #1a1a19; border-radius: 20px; padding: 22px;
         box-shadow: 0 0 0 1px rgba(255,255,255,.06); }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -.02em; }
  p { margin: 0 0 16px; color: #c3c2b7; }
  label { display: block; font-size: 13px; color: #a09e95; margin-bottom: 6px; }
  input { width: 100%; box-sizing: border-box; font: inherit; color: #fff; background: #252523; border: 1px solid #3a3a37;
          border-radius: 12px; padding: 12px; }
  button { width: 100%; margin-top: 12px; font: 600 15px system-ui, sans-serif; color: #0d0d0d; background: #fff; border: 0;
           border-radius: 12px; padding: 12px; cursor: pointer; }
  .err { color: #f07171; margin: 10px 0 0; }
</style></head><body>
<form method="post" action="/__login">
  <h1>Morning Brief</h1><p>Private dashboard. Enter your password.</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="username" autocomplete="username" value="sanjay">
  <button type="submit">Open dashboard</button>${note}
</form></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  // No market data in these: freshness for an outside check, and the home-screen app's
  // manifest, icons and offline worker (iOS fetches the icon before you sign in).
  if (PUBLIC.has(url.pathname)) return next();

  const password = env.DASHBOARD_PASSWORD;
  if (!password) return new Response("Dashboard password is not set yet.", { status: 503 });
  const token = await tokenFor(password);

  if (url.pathname === "/__login" && request.method === "POST") {
    const form = await request.formData();
    if (sameString(await tokenFor(String(form.get("password") || "")), token)) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/", "Set-Cookie": `${COOKIE}=${token}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax` },
      });
    }
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return loginPage("That password didn't match.");
  }
  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 303,
      headers: { Location: "/", "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  const cookie = readCookie(request, COOKIE);
  if (cookie && sameString(cookie, token)) {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("x-robots-tag", "noindex, nofollow");
    out.headers.set("cache-control", "private, no-store");
    return out;
  }
  return loginPage("");
}
