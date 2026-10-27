// Web Push for the CRM: lock-screen notifications on the phone, no app store, no third party.
// Encryption follows RFC 8291 (aes128gcm) and the sender proves itself with VAPID (RFC 8292).
// The signing key is made once and kept in the database (table kv), never sent to the page.
// Used by the Pages API (inbound leads, test) and the scheduler Worker (reminders).

const enc = new TextEncoder();
const VAPID_SUBJECT = "https://sanjay-market-brief.pages.dev";

export const b64u = {
  encode(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// The aes128gcm body for one push message. `opts` lets the RFC 8291 test vector pin the random parts.
export async function encrypt(payload, p256dh, auth, opts = {}) {
  const uaPublic = typeof p256dh === "string" ? b64u.decode(p256dh) : p256dh;
  const authSecret = typeof auth === "string" ? b64u.decode(auth) : auth;
  const local = opts.localKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2])); // 0x02 = last record
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// VAPID keys: made once, stored in kv.
export async function vapidKeys(db) {
  const row = await db.prepare("SELECT value FROM kv WHERE key = 'vapid'").first();
  if (row) {
    const jwk = JSON.parse(row.value);
    return { jwk, publicKey: jwk.pub };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  jwk.pub = b64u.encode(await crypto.subtle.exportKey("raw", pair.publicKey));
  await db.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(jwk)).run();
  return vapidKeys(db); // re-read so two racing first calls agree on one key
}

async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const { pub, ...jwk } = keys.jwk;
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${keys.publicKey}`;
}

// Send one notification to every device that turned them on. Dead subscriptions are removed.
// msg: { title, body, url, tag }
export async function notifyAll(db, msg) {
  const subs = (await db.prepare("SELECT * FROM push_subs").all()).results;
  if (!subs.length) return { sent: 0, devices: 0 };
  const keys = await vapidKeys(db);
  const payload = JSON.stringify({ title: msg.title, body: msg.body || "", url: msg.url || "/", tag: msg.tag || undefined });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: msg.urgency || "high",
          authorization: await vapidHeader(s.endpoint, keys) },
        body: await encrypt(payload, s.p256dh, s.auth),
      });
      if (res.status === 404 || res.status === 410) await db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run();
      else if (res.ok) sent++;
    } catch (e) { /* one device failing never blocks the rest */ }
  }));
  return { sent, devices: subs.length };
}

// Send at most once per key (e.g. "meeting-12-60m"): the scheduler runs every few minutes.
export async function notifyOnce(db, key, msg) {
  const r = await db.prepare("INSERT OR IGNORE INTO notified (key) VALUES (?)").bind(key).run();
  if (!r.meta || !r.meta.changes) return null;
  return notifyAll(db, msg);
}
