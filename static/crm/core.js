// Sanjay Ram CRM · core: vocabulary, DOM and form helpers, API with an offline queue and a cache,
// sheets and toasts, the app shell (sidebar on a laptop, tab bar on the phone) and the router.
// The other files (sheets.js, views.js, admin.js) add to window.CRM; admin.js starts the app.
(() => {
  "use strict";
  const C = (window.CRM = {});
  const GST = 4 * 3600e3;
  const TZ = "Asia/Dubai";
  C.AED_PER_USD = 3.6725;

  // ---------- vocabulary ----------
  C.STATUS = { new: "New", attempting: "Attempting", conversation: "Spoke", meeting_booked: "Meeting booked", meeting_held: "Met",
    qualified: "Qualified", eoi: "EOI", won: "Won", lost: "Lost", dnc: "Do not call" };
  C.TEMP = { hot: "Hot", warm: "Warm", nurture: "Nurture", cold: "Cold" };
  C.SOURCE = { warm: "Warm network", lyka: "Lyka CRM", content: "Content", referral: "Referral", linkedin: "LinkedIn", apollo: "Apollo",
    db: "Owner database", portal: "Website / form", propertyfinder: "Property Finder", bayut: "Bayut", dubizzle: "Dubizzle",
    meta: "Meta lead ads", ads: "Other paid ads", other: "Other" };
  C.ICP = { nri: "Indian / NRI abroad", upgrader: "Dubai renter → owner", other: "Other" };
  C.LANE = { waterfront: "Waterfront / coastal", growth: "Growth corridor (Dubai South)", value: "Best-value launch" };
  C.NEED = { rental: "Rental income", growth: "Capital growth", residency: "Residency / Golden Visa", end_use: "Live in it",
    retire: "Retire into", diversify: "Diversify out of India/US", investment: "Investment (unclear)" };
  C.COUNTRY = { AE: "UAE", IN: "India", US: "USA", UK: "UK", SA: "Saudi", QA: "Qatar", other: "Other" };
  C.COUNTRY_TZ = { AE: "Asia/Dubai", IN: "Asia/Kolkata", US: "America/New_York", UK: "Europe/London", SA: "Asia/Riyadh", QA: "Asia/Qatar" };
  C.OUTCOME = { no_answer: "No answer", busy: "Busy", voicemail: "Voicemail", wrong_number: "Wrong number", sent: "Message sent",
    replied: "Replied", conversation: "Spoke", callback: "Call back", booked: "Booked meeting", stay_in_touch: "Stay in touch",
    referral: "Referral", not_interested: "Not interested", dnc_request: "Asked not to call" };
  C.STAGES = [["eoi", "EOI"], ["allocation", "Allocation"], ["booking", "Booking"], ["spa", "SPA"], ["oqood", "Oqood"], ["paid", "Commission paid"]];
  C.STAGE = Object.fromEntries([...C.STAGES, ["fell_through", "Fell through"]]);
  C.MEET_KIND = { video: "Video call", site_visit: "Site visit", office: "Office", phone: "Phone" };
  C.MEET_STATUS = { booked: "Booked", held: "Held", no_show: "No-show", rescheduled: "Rescheduled", cancelled: "Cancelled" };
  C.TASK_KIND = { follow_up: "Follow up", call: "Call", whatsapp: "WhatsApp", email: "Email", meeting_prep: "Meeting prep", admin: "Admin", content: "Content" };
  C.RELATION = { spouse: "Spouse", parent: "Parent", partner: "Business partner", sibling: "Sibling", child: "Child", advisor: "Advisor", other: "Other" };
  C.OBJECTIONS = [
    { k: "another_agent", q: "Another agent offered the same unit with a discount / cashback", why: "Price comparison: you're seen as a commodity",
      move: "“Totally fair. What else did they show you, and why that unit?” Then re-sell your filter, shortlist and after-sale service. Don't match illegal or unapproved cashback." },
    { k: "bubble", q: "Dubai is in a bubble / prices will crash", why: "Fear",
      move: "“I understand, a lot of people are asking. What would you need to see to feel safe?” Show data, payment-plan exposure, developer track record. Never promise prices." },
    { k: "offplan_risk", q: "Off-plan is risky: what if the developer delays?", why: "Trust",
      move: "Escrow and Oqood registration, developer handover history: that's why your filter checks delivery record first." },
    { k: "family", q: "I need to discuss with my wife / family", why: "Missing decision-maker (Gate 2 leak)",
      move: "“Of course, let's get her on a call. Tomorrow at 7 or Saturday at 11?”" },
    { k: "think", q: "Let me think about it", why: "Unclear gap", move: "1–10 close. “What would make it a 10?”" },
    { k: "brochure", q: "Send me the brochure on WhatsApp", why: "Brush-off",
      move: "“I will, and so will 10 other agents. What I do differently is shortlist the 3 that fit you. 15 minutes Thursday?”" },
    { k: "wait", q: "I'll wait for the launch / for prices to drop", why: "Timing",
      move: "“What changes for you by waiting?” Show how allocation works in hot launches (best units go early). Only use urgency that's real." },
    { k: "price", q: "Can you do something on the price?", why: "Buying objection: they've decided",
      move: "Stay light. Check payment-plan flexibility or a better floor with the developer." },
    { k: "budget", q: "I don't have the budget right now", why: "Access vs allocation", move: "No access → nurture with a date. Allocation → realign on value." },
    { k: "busy", q: "I'm travelling / busy", why: "Timing", move: "Reschedule for when they can actually decide." },
  ];
  C.OBJ = Object.fromEntries(C.OBJECTIONS.map((o) => [o.k, o]));
  C.opts = (obj) => Object.entries(obj);

  // ---------- DOM ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "value") value = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    if (value !== undefined) el.value = value;
    return el;
  }
  C.h = h;
  const ICONS = {
    today: "M5 4h2l2 5-2.5 1.5a11 11 0 0 0 5 5L13 13l5 2v2a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2",
    call: "M5 4h2l2 5-2.5 1.5a11 11 0 0 0 5 5L13 13l5 2v2a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2",
    leads: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6",
    pipeline: "M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v7h-4z",
    market: "M4 19l5-6 4 3 7-9M15 7h5v5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    tasks: "M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
    calendar: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4",
    numbers: "M5 20V11M12 20V4M19 20v-8",
    wa: "M4 20l1.3-3.9A8 8 0 1 1 8 19z",
    log: "M4 6h16M4 12h10M4 18h7",
    back: "M15 18l-6-6 6-6",
    chevron: "M9 6l6 6-6 6",
    plus: "M12 5v14M5 12h14",
    search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
    filter: "M4 6h16M7 12h10M10 18h4",
    check: "M5 12.5l4.5 4.5L19 7.5",
    edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    bell: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0",
    sync: "M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M19 3v5h-5M5 21v-5h5",
    select: "M4 6l2 2 4-4M4 16l2 2 4-4M13 6h7M13 16h7",
    money: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4",
    people: "M16 19a4 4 0 0 0-8 0M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 18a3 3 0 0 0-2-2.8M17 6.3a3 3 0 0 1 0 5.4M5 18a3 3 0 0 1 2-2.8M7 6.3a3 3 0 0 0 0 5.4",
    x: "M6 6l12 12M18 6L6 18",
  };
  C.icon = (name, size = 20) => {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": name === "more" ? 3 : 1.9, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "ic" })) s.setAttribute(k, v);
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", ICONS[name] || ICONS.more); s.append(p);
    return s;
  };

  // ---------- time & money ----------
  const gulf = (iso) => new Date(Date.parse(iso) + GST).toISOString();
  const gulfToday = () => gulf(new Date().toISOString()).slice(0, 10);
  const fromGulf = (date, time = "09:00") => new Date(Date.parse(`${date}T${time}:00+04:00`)).toISOString();
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
  const gulfHour = () => { const g = gulf(new Date().toISOString()); return Number(g.slice(11, 13)) + Number(g.slice(14, 16)) / 60; };
  const fmt = (iso, o) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(new Date(iso.length === 10 ? fromGulf(iso, "12:00") : iso)) : "");
  const fmtTime = (iso) => fmt(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDay = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
  const fmtWhen = (iso) => {
    if (!iso) return "";
    const d = gulf(iso).slice(0, 10), t = gulfToday(), time = fmtTime(iso);
    if (d === t) return `Today ${time}`;
    if (d === addDays(t, 1)) return `Tomorrow ${time}`;
    if (d === addDays(t, -1)) return `Yesterday ${time}`;
    return `${fmtDay(iso)} ${time}`;
  };
  const dayLabel = (date) => {
    const t = gulfToday();
    if (date === t) return "Today";
    if (date === addDays(t, 1)) return "Tomorrow";
    if (date === addDays(t, -1)) return "Yesterday";
    return fmt(date, { weekday: "long", day: "numeric", month: "short" });
  };
  const ago = (iso) => {
    if (!iso) return "";
    const m = (Date.now() - Date.parse(iso)) / 6e4;
    if (m < 1) return "just now";
    if (m < 60) return `${Math.floor(m)}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    if (m < 1440 * 30) return `${Math.floor(m / 1440)}d ago`;
    return fmtDay(iso);
  };
  const aed = (v) => {
    if (v == null || v === "") return "n/a";
    v = Number(v);
    if (Math.abs(v) >= 1e6) return `AED ${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}m`;
    if (Math.abs(v) >= 1e3) return `AED ${Math.round(v / 1e3)}k`;
    return `AED ${Math.round(v)}`;
  };
  const usd = (vAed) => { const u = Number(vAed || 0) / C.AED_PER_USD; return Math.abs(u) >= 1e3 ? `$${(u / 1e3).toFixed(u >= 1e5 ? 0 : 1).replace(/\.0$/, "")}k` : `$${Math.round(u)}`; };
  Object.assign(C, { gulf, gulfToday, fromGulf, addDays, mondayOf, gulfHour, fmt, fmtTime, fmtDay, fmtWhen, dayLabel, ago, aed, usd,
    both: (v) => `${aed(v)} (${usd(v)})`,
    pct: (x) => (x == null ? "n/a" : `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`),
    netOf: (d) => (Number(d.price_aed) || 0) * (Number(d.commission_pct) || 0) / 100 * (Number(d.split_pct) || 0) / 100,
    first: (name) => String(name || "").trim().split(/\s+/)[0] || "",
    digits: (p) => String(p || "").replace(/\D/g, ""),
    isUae: (l) => l.country === "AE" || String(l.phone || "").startsWith("+971"),
    localTime: (l) => {
      const tz = C.COUNTRY_TZ[l.country];
      if (!tz || tz === TZ) return null;
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    },
    localHour: (l) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: C.COUNTRY_TZ[l.country] || TZ, hour: "numeric", hour12: false }).format(new Date())) % 24,
    devPct: (dev) => {
      const k = String(dev || "").trim().toLowerCase();
      const hit = k && (C.settings?.developer_commissions || []).find((x) => String(x.developer || "").trim().toLowerCase() === k);
      return hit ? Number(hit.pct) : null;
    },
  });

  // ---------- API, cache, offline queue ----------
  const busyEl = () => document.getElementById("busy");
  let busy = 0;
  const setBusy = (d) => { busy += d; busyEl()?.classList.toggle("on", busy > 0); };
  const QUEUE = "crm-queue-v1";
  const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || "[]"); } catch (e) { return []; } };
  const writeQueue = (q) => { try { localStorage.setItem(QUEUE, JSON.stringify(q)); } catch (e) { /* ignore */ } paintSync(); };
  // opts.queue: if there's no signal, keep the change on the phone and send it later.
  async function api(path, opts = {}) {
    const method = opts.method || "GET";
    if (opts.queue && method !== "GET" && !navigator.onLine) return enqueue(path, opts);
    setBusy(1);
    try {
      let res;
      try {
        res = await fetch(`/api/crm/${path}`, { method, credentials: "same-origin",
          headers: opts.body ? { "content-type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
      } catch (netErr) {
        if (opts.queue && method !== "GET") return enqueue(path, opts);
        throw new Error("No connection");
      }
      if (res.status === 401) { location.reload(); throw new Error("Signed out"); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.data = data; throw e; }
      if (method !== "GET") invalidate();
      return data;
    } finally { setBusy(-1); }
  }
  function enqueue(path, opts) {
    const q = readQueue();
    q.push({ path, method: opts.method, body: opts.body, at: Date.now() });
    writeQueue(q);
    return { queued: true };
  }
  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine) return;
    let q = readQueue();
    if (!q.length) return;
    flushing = true;
    let sent = 0;
    try {
      while (q.length) {
        const item = q[0];
        try { await api(item.path, { method: item.method, body: item.body }); }
        catch (e) { if (e.message === "No connection") break; /* rejected by the server: drop it, don't block the rest */ }
        q = readQueue(); q.shift(); writeQueue(q); sent++;
      }
    } finally { flushing = false; }
    if (sent) { C.toast(`Synced ${sent} change${sent > 1 ? "s" : ""}`); C.refresh(); }
  }
  function paintSync() {
    const n = readQueue().length;
    document.querySelectorAll(".syncbadge").forEach((b) => { b.hidden = !n; b.querySelector("span").textContent = `${n} to sync`; });
  }
  addEventListener("online", flush);
  setInterval(flush, 30000);

  // Reads are cache-first: a screen draws at once from the last copy, then refreshes quietly
  // and redraws only if something changed. The copy survives closing the app (this device only).
  const STORE = "crm-cache-v2";
  const memo = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(STORE) || "{}"))) memo.set(k, { data: v, at: 0 }); } catch (e) { /* private mode */ }
  let saveTimer;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...memo].slice(-50).map(([k, v]) => [k, v.data])))); } catch (e) { /* full */ }
  }, 400); };
  const sig = (d) => JSON.stringify(d, (k, v) => (k === "now" ? undefined : v));
  const inflight = new Map();
  function fetchFresh(path) {
    if (inflight.has(path)) return inflight.get(path);
    const loader = path.startsWith("/") ? fetch(path, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`Error ${r.status}`);
      return path.endsWith(".json") ? r.json() : r.text();
    }) : api(path);
    const pr = loader.then((data) => {
      const old = memo.get(path);
      const changed = !old || sig(old.data) !== sig(data);
      memo.delete(path); memo.set(path, { data, at: Date.now() }); persist();
      return { data, changed };
    }).finally(() => inflight.delete(path));
    inflight.set(path, pr);
    return pr;
  }
  // get("today") → /api/crm/today ; get("/market/brief.json") → a static file
  async function get(path) {
    const hit = memo.get(path);
    if (hit) {
      if (Date.now() - hit.at > 4000) fetchFresh(path).then((r) => { if (r.changed) softRender(); }).catch(() => {});
      return hit.data;
    }
    return (await fetchFresh(path)).data;
  }
  function invalidate() { for (const v of memo.values()) v.at = 0; }
  C.api = api; C.get = get; C.invalidate = invalidate; C.flush = flush; C.queued = () => readQueue().length;
  C.forgetCache = () => { try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ } };
  C.loadSettings = async () => (C.settings = (await get("settings")).settings);

  // ---------- toast, sheets, confirm ----------
  let toastTimer;
  C.toast = (msg, action) => {
    const el = document.getElementById("toast");
    el.replaceChildren(h("span", null, msg), ...(action ? [h("button", { type: "button", onclick: () => { el.classList.remove("on"); action.fn(); } }, action.label)] : []));
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), action ? 6000 : 2600);
  };
  C.fail = (e) => C.toast(e.message || "Something went wrong");

  const sheetStack = [];
  C.sheetOpen = () => sheetStack.length > 0;
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".sheet-f .btn, .savebar .btn");
    if (b && !b.disabled) { b.classList.add("working"); setTimeout(() => b.classList.remove("working"), 1500); }
  }, true);
  // Each open sheet adds a history entry, so a back swipe (or Android back) closes the sheet
  // instead of leaving the page.
  C.sheet = (title, body, footer, opts = {}) => {
    let closed = false;
    const tag = Math.random().toString(36).slice(2);
    const close = (fromHistory = false) => {
      if (closed) return; closed = true;
      wrap.classList.add("closing");
      setTimeout(() => wrap.remove(), 160);
      const i = sheetStack.indexOf(close); if (i >= 0) sheetStack.splice(i, 1);
      if (!sheetStack.length) { document.body.classList.remove("sheet-open"); if (pendingRender) softRender(); }
      // Closed by a button: drop the sheet's history entry, unless the code navigated somewhere right after.
      // (Only this sheet's own entry: if the next sheet already opened, leave it alone.)
      if (fromHistory !== true) setTimeout(() => { if (history.state?.crmSheet === tag) history.back(); }, 0);
    };
    const wrap = h("div", { class: `sheet-wrap${opts.wide ? " wide" : ""}`, onclick: (e) => { if (e.target === wrap) close(); } },
      h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "grabber", "aria-hidden": "true" }),
        h("div", { class: "sheet-h" }, h("h2", null, title), h("button", { class: "x", type: "button", "aria-label": "Close", onclick: close }, C.icon("x", 18))),
        h("div", { class: "sheet-b" }, body),
        footer ? h("div", { class: "sheet-f" }, footer) : null));
    document.body.append(wrap);
    document.body.classList.add("sheet-open");
    sheetStack.push(close);
    history.pushState({ crmSheet: tag }, "");
    dragToClose(wrap.querySelector(".sheet"), close);
    if (!opts.noFocus && matchMedia("(min-width: 1024px)").matches) {
      setTimeout(() => { if (!wrap.contains(document.activeElement)) wrap.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=date]):not([type=time]), textarea")?.focus({ preventScroll: true }); }, 60);
    }
    return close;
  };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetStack.length) sheetStack[sheetStack.length - 1](); });
  addEventListener("popstate", (e) => {
    if (sheetStack.length) { sheetStack[sheetStack.length - 1](true); return; }
    if (e.state?.crmSheet) history.back(); // a leftover sheet entry: skip straight past it
  });
  // Drag a sheet down to dismiss it: by its top, or anywhere once its content is scrolled to the top.
  function dragToClose(sheetEl, close) {
    const body = sheetEl.querySelector(".sheet-b");
    let y0 = null, dy = 0, fromBody = false, active = false;
    sheetEl.addEventListener("touchstart", (e) => {
      const inHead = !body.contains(e.target);
      fromBody = !inHead;
      if (fromBody && body.scrollTop > 0) { y0 = null; return; }
      if (e.target.closest("input, textarea, select")) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0; active = false;
    }, { passive: true });
    sheetEl.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (!active && dy > 8) active = true;
      if (!active) return;
      if (dy < 0) { dy = 0; }
      if (fromBody) e.preventDefault(); // stop the content bouncing while the sheet follows the finger
      sheetEl.style.transition = "none";
      sheetEl.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    sheetEl.addEventListener("touchend", () => {
      if (y0 === null) return;
      sheetEl.style.transition = "transform .2s ease-out";
      if (active && dy > 110) { sheetEl.style.transform = "translateY(100%)"; close(); }
      else sheetEl.style.transform = "";
      y0 = null; active = false;
    });
  }
  // iPhone home-screen apps have no system back swipe: swipe right from the left edge to go back.
  (() => {
    let x0 = null, y0 = 0;
    addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX < 24 && !sheetStack.length ? t.clientX : null; y0 = t.clientY; }, { passive: true });
    addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const t = e.changedTouches[0];
      if (t.clientX - x0 > 80 && Math.abs(t.clientY - y0) < 60) {
        const back = document.querySelector(".tb-back:not([hidden])");
        if (C._navCount > 0) history.back(); else if (back) location.hash = back.getAttribute("href").slice(1);
      }
      x0 = null;
    }, { passive: true });
  })();
  // A sheet instead of confirm()/prompt(): resolves to true / the text, or null when cancelled.
  C.ask = (title, { text, input, value, ok = "OK", danger = false, placeholder } = {}) => new Promise((resolve) => {
    let done = false;
    const field = input ? h("input", { type: "text", value: value || "", placeholder: placeholder || "" }) : null;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const close = C.sheet(title, h("div", null, text ? h("p", { class: "fhint" }, text) : null, field ? h("div", { class: "fld" }, field) : null),
      [h("button", { class: `btn${danger ? " danger" : ""}`, type: "button", onclick: () => finish(field ? field.value.trim() : true) }, ok),
       h("button", { class: "btn ghost", type: "button", onclick: () => finish(null) }, "Cancel")], { noFocus: !input });
    if (field) setTimeout(() => field.focus(), 60);
  });

  // ---------- form builder ----------
  // spec: { k, label, type, options: [[value,label]], num, half, hint, placeholder, required, quick, oninput, onchange }
  C.form = (specs, values = {}) => {
    const getters = {};
    const el = h("div", { class: "form" });
    for (const sp of specs) {
      if (!sp) continue;
      if (sp.type === "heading") { el.append(h("h3", { class: "fh" }, sp.label), sp.hint ? h("p", { class: "fhint" }, sp.hint) : null); continue; }
      if (sp.type === "note") { el.append(h("p", { class: "fhint" }, sp.label)); continue; }
      if (sp.type === "el") { el.append(sp.el); continue; }
      const v = values[sp.k];
      const id = `f-${sp.k}-${Math.random().toString(36).slice(2, 7)}`;
      let input;
      const label = h("label", { for: id }, sp.label, sp.required ? h("span", { class: "req" }, " *") : null);
      if (sp.type === "chips" || sp.type === "multi" || sp.type === "pass") {
        const list = sp.type === "pass" ? [["1", "Passed ✓"], ["0", "Not passed"]] : sp.options;
        const multi = sp.type === "multi";
        let cur = multi ? new Set(Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch (e) { return []; } })()) : (v == null ? "" : String(v));
        const group = h("div", { class: "chips pick", role: multi ? "group" : "radiogroup", id });
        const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(multi ? cur.has(b.dataset.v) : cur === b.dataset.v)));
        for (const [ov, ol] of list) {
          group.append(h("button", { type: "button", "data-v": String(ov), onclick: () => {
            if (multi) { cur.has(String(ov)) ? cur.delete(String(ov)) : cur.add(String(ov)); }
            else cur = cur === String(ov) && !sp.required ? "" : String(ov);
            paint(); sp.onchange?.(getters[sp.k]());
          } }, ol));
        }
        paint();
        getters[sp.k] = () => (multi ? [...cur] : cur === "" ? null : sp.num || sp.type === "pass" ? Number(cur) : cur);
        el.append(h("div", { class: `fld${sp.half ? " half" : ""}` }, label, group, sp.hint ? h("small", null, sp.hint) : null));
        continue;
      }
      if (sp.type === "datetime") {
        const g = v ? gulf(v) : "";
        const d = h("input", { type: "date", id, value: g.slice(0, 10) });
        const t = h("input", { type: "time", value: g ? g.slice(11, 16) : sp.defaultTime || "", step: 300 });
        const quick = sp.quick ? h("div", { class: "chips" }, sp.quick.map(([ql, qd, qt]) => h("button", { type: "button", onclick: () => { d.value = qd; t.value = qt; } }, ql))) : null;
        getters[sp.k] = () => (d.value ? fromGulf(d.value, t.value || sp.defaultTime || "09:00") : null);
        el.append(h("div", { class: "fld" }, label, quick, h("div", { class: "dt" }, d, t), sp.hint ? h("small", null, sp.hint) : null));
        continue;
      }
      if (sp.type === "date") {
        input = h("input", { type: "date", id, value: v ? (v.length > 10 ? gulf(v).slice(0, 10) : v) : "" });
        getters[sp.k] = () => (input.value ? (sp.iso ? fromGulf(input.value, "12:00") : input.value) : null);
      } else if (sp.type === "select") {
        input = h("select", { id }, h("option", { value: "" }, sp.placeholder || "—"), sp.options.map(([ov, ol]) => h("option", { value: String(ov) }, ol)));
        input.value = v == null ? "" : String(v);
        getters[sp.k] = () => (input.value === "" ? null : sp.num ? Number(input.value) : input.value);
        if (sp.onchange) input.addEventListener("change", () => sp.onchange(getters[sp.k]()));
      } else if (sp.type === "textarea") {
        input = h("textarea", { id, rows: sp.rows || 3, placeholder: sp.placeholder || "", value: v ?? "" });
        getters[sp.k] = () => input.value.trim() || null;
      } else {
        const t = sp.type === "money" ? "number" : sp.type || "text";
        input = h("input", { id, type: t, inputmode: sp.type === "money" || sp.type === "number" ? "decimal" : sp.type === "tel" ? "tel" : null,
          placeholder: sp.placeholder || "", value: v ?? "", step: sp.step || (t === "number" ? "any" : null),
          autocomplete: sp.autocomplete || "off", autocapitalize: sp.type === "email" ? "none" : null, enterkeyhint: "next" });
        getters[sp.k] = () => { const x = input.value.trim(); if (x === "") return null; return t === "number" ? Number(x) : x; };
      }
      if (sp.oninput) input.addEventListener("input", () => sp.oninput(getters[sp.k]()));
      el.append(h("div", { class: `fld${sp.half ? " half" : ""}`, "data-k": sp.k }, label, input, sp.hint ? h("small", null, sp.hint) : null));
    }
    return { el, get: () => Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()])), input: (k) => el.querySelector(`[data-k="${k}"] input, [data-k="${k}"] select, [data-k="${k}"] textarea`) };
  };
  C.quickDays = () => {
    const t = gulfToday();
    return [["Today 18:00", t, "18:00"], ["Tomorrow", addDays(t, 1), "10:00"], ["In 3 days", addDays(t, 3), "10:00"], ["In a week", addDays(t, 7), "10:00"], ["In a month", addDays(t, 30), "10:00"]];
  };

  // ---------- shared pieces ----------
  C.card = (title, sub, ...kids) => h("section", { class: "card" }, title != null ? h("h2", null, h("span", null, title), sub != null ? h("small", null, sub) : null) : null, ...kids);
  C.empty = (text, ...kids) => h("div", { class: "empty-state" }, h("p", null, text), ...kids);
  C.bar = (n, target, label) => {
    const p = target ? Math.min(1, n / target) : 0;
    return h("div", { class: "kbar" }, h("div", { class: "kl" }, h("span", null, label), h("b", null, `${n ?? 0}`, h("em", null, ` / ${target}`))),
      h("div", { class: "track" }, h("span", { class: p >= 1 ? "full" : "", style: `width:${(p * 100).toFixed(1)}%` })));
  };
  C.tempDot = (t) => h("i", { class: `dot t-${t || "warm"}`, title: C.TEMP[t] || "" });
  C.seg = (items, current, onpick, cls = "") => h("div", { class: `seg ${cls}`, role: "tablist" }, items.map(([v, l]) =>
    h("button", { type: "button", role: "tab", "aria-pressed": String(v === current), onclick: () => onpick(v) }, l)));
  C.isDesktop = () => matchMedia("(min-width: 1024px)").matches;

  // Swipe a row on the phone: right = call, left = log. Vertical scrolling is left alone.
  C.swipeable = (row, { right, left, rightLabel = "Call", leftLabel = "Log" }) => {
    if (!("ontouchstart" in window)) return row;
    const wrap = h("div", { class: "swipe" }, h("div", { class: "swipe-bg" }, h("span", { class: "l" }, C.icon("call", 18), rightLabel), h("span", { class: "r" }, leftLabel, C.icon("log", 18))), row);
    let x0, y0, dx = 0, lock = null;
    row.addEventListener("touchstart", (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; lock = null; row.style.transition = "none"; }, { passive: true });
    row.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      const ddx = t.clientX - x0, ddy = t.clientY - y0;
      if (lock === null && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) lock = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
      if (lock !== "x") return;
      dx = Math.max(-120, Math.min(120, ddx));
      if ((dx > 0 && !right) || (dx < 0 && !left)) dx = 0;
      row.style.transform = `translateX(${dx}px)`;
      wrap.classList.toggle("go-r", dx > 70); wrap.classList.toggle("go-l", dx < -70);
    }, { passive: true });
    row.addEventListener("touchend", () => {
      row.style.transition = ""; row.style.transform = "";
      wrap.classList.remove("go-r", "go-l");
      if (lock === "x") { if (dx > 70) right?.(); else if (dx < -70) left?.(); }
    });
    // Stop the tap that ends a swipe from opening the row.
    row.addEventListener("click", (e) => { if (lock === "x" && Math.abs(dx) > 8) { e.preventDefault(); e.stopPropagation(); } }, true);
    return wrap;
  };

  // ---------- shell & router ----------
  // A view returns: { title, sub, back: [href, label], actions: [el], body: [el], wide, className }
  C.routes = {};
  C.route = (name, fn, o = {}) => { C.routes[name] = { fn, nav: o.nav || name, split: !!o.split, prefetch: o.prefetch }; };
  const LEGACY = { brief: "market/brief", rent: "market/rent", news: "market/news", villas: "market/more", review: "review" };
  const view = () => document.getElementById("view");
  let renderSeq = 0, pendingRender = false;
  const skeleton = () => h("div", { class: "skel" }, h("div", { class: "sk sk-h" }), h("div", { class: "sk sk-card" }), h("div", { class: "sk sk-card" }), h("div", { class: "sk sk-card short" }));

  function header(pg) {
    return h("header", { class: "page-h" },
      pg.back ? h("a", { class: "back", href: `#${pg.back[0]}`, onclick: (e) => { if (history.length > 1 && C._navCount > 1) { e.preventDefault(); history.back(); } } }, C.icon("back", 18), pg.back[1]) : null,
      h("div", { class: "ph-row" },
        h("div", { class: "ph-t" }, h("h1", null, pg.title), pg.sub ? h("p", { class: "sub" }, pg.sub) : null),
        pg.actions?.length ? h("div", { class: "ph-a" }, pg.actions) : null));
  }
  function mountPage(container, pg, keepScroll, scroller) {
    const y = keepScroll ? (scroller ? scroller.scrollTop : scrollY) : 0;
    const node = h("div", { class: `page${pg.wide ? " wide" : ""}${pg.className ? ` ${pg.className}` : ""}` }, header(pg), h("div", { class: "page-b" }, pg.body));
    container.replaceChildren(node);
    // Compact title in the top bar (phone) once the big one scrolls away.
    const tb = document.getElementById("topbar");
    if (!scroller && tb) {
      tb.querySelector(".tb-title").textContent = (pg.title && pg.title.nodeType ? pg.title.textContent : pg.title) || "";
      const backEl = tb.querySelector(".tb-back");
      backEl.hidden = !pg.back;
      if (pg.back) { backEl.href = `#${pg.back[0]}`; backEl.querySelector("span").textContent = pg.back[1]; }
      tb.querySelector(".tb-a").replaceChildren(...(pg.actions || []).filter((a) => a && a.dataset?.top !== "no").map((a) => {
        const c = a.cloneNode(true); c.addEventListener("click", (e) => { e.preventDefault(); a.click(); }); return c; }));
      onScroll();
    }
    if (keepScroll) { if (scroller) scroller.scrollTop = y; else scrollTo(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)); }
    return node;
  }
  function onScroll() {
    const tb = document.getElementById("topbar");
    if (!tb) return;
    const h1 = view().querySelector(".page-h h1");
    const past = h1 ? h1.getBoundingClientRect().bottom < tb.getBoundingClientRect().bottom + 4 : scrollY > 40;
    tb.classList.toggle("scrolled", past);
  }
  addEventListener("scroll", onScroll, { passive: true });

  C._navCount = 0;
  async function render(keepScroll = false) {
    let raw = location.hash.slice(1) || "today";
    if (LEGACY[raw]) raw = LEGACY[raw];
    const [name, ...rest] = raw.split("/");
    const arg = rest.join("/");
    const r = C.routes[name] || C.routes.today;
    document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === r.nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.body.dataset.route = name;
    const seq = ++renderSeq;
    pendingRender = false;
    const split = r.split && C.isDesktop();
    if (!keepScroll && !split) scrollTo(0, 0);
    const slow = keepScroll ? null : setTimeout(() => { if (seq === renderSeq && !split) view().replaceChildren(skeleton()); }, 140);
    try {
      if (!C.settings) await C.loadSettings();
      if (split) { await C.renderSplit(name, arg, keepScroll, () => seq === renderSeq); clearTimeout(slow); return; }
      document.body.classList.remove("split-on");
      const pg = await r.fn(arg);
      clearTimeout(slow);
      if (seq !== renderSeq) return;
      mountPage(view(), pg, keepScroll);
    } catch (e) {
      clearTimeout(slow);
      if (seq !== renderSeq) return;
      mountPage(view(), { title: "Couldn't load", body: [h("div", { class: "card" }, h("p", { class: "warnbox" }, e.message || "Something went wrong."),
        e.status === 503 ? h("p", { class: "fhint" }, "The database isn't connected yet. See README → CRM.") : null,
        h("button", { class: "btn ghost", type: "button", onclick: () => render() }, "Try again"))] });
    }
  }
  C.mountPage = mountPage;
  C.render = render;
  C.refresh = () => { invalidate(); render(true); };
  // Fresh data arrived for the screen on show: redraw in place, but never under an open sheet or while you type.
  function softRender() {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.getElementById("app").contains(document.activeElement);
    if (sheetStack.length || typing) { pendingRender = true; return; }
    render(true);
  }
  C.softRender = softRender;

  C.start = () => {
    addEventListener("hashchange", () => { C._navCount++; render(); });
    document.getElementById("fab")?.addEventListener("click", () => C.leadSheet());
    document.querySelectorAll("[data-action=new-lead]").forEach((b) => b.addEventListener("click", () => C.leadSheet()));
    // Signing out also forgets the copy of your data kept on this device.
    document.addEventListener("click", (e) => { if (e.target.closest('a[href="/__logout"]')) { C.forgetCache(); try { localStorage.removeItem(QUEUE); } catch (er) { /* ignore */ } } });
    // Laptop shortcuts: n new lead, t new task, / search, 1–7 sections.
    addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sheetStack.length || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (e.key === "n") { e.preventDefault(); C.leadSheet(); }
      else if (e.key === "t") { e.preventDefault(); C.taskSheet(); }
      else if (e.key === "/") { e.preventDefault(); if (!/^#(leads|lead)/.test(location.hash)) location.hash = "leads"; setTimeout(() => document.querySelector(".lp-search input")?.focus(), 120); }
      else { const nav = ["today", "tasks", "leads", "pipeline", "calendar", "numbers", "market"][Number(e.key) - 1]; if (nav) location.hash = nav; }
    });
    // Live timers on inbound leads (red after 5 minutes).
    setInterval(() => document.querySelectorAll(".timer[data-since]").forEach(C.paintTimer), 10000);
    // Back to the app after a while: refresh what's on screen.
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else { flush(); if (hiddenAt && Date.now() - hiddenAt > 120000 && !sheetStack.length) C.refresh(); }
    });
    matchMedia("(min-width: 1024px)").addEventListener("change", () => render());
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
    paintSync();
    // No pinch-zoom: a home-screen app on iPhone can stay zoomed out and never bounce back.
    // (Safari's own gesture events; the viewport tag and touch-action cover the rest.)
    for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    // iPhone/iPad in "Request Desktop Website" mode lays the page out ~980 px wide and shrinks it to fit
    // (tiny, centred, tab bar off-screen). Say how to switch back instead of looking broken.
    if (navigator.maxTouchPoints > 0 && screen.width < 900 && innerWidth > screen.width * 1.4) {
      document.body.prepend(h("div", { class: "modebar", role: "alert" }, "This page is in desktop mode, so it's shrunk. In Safari tap ",
        h("b", null, "aA"), " → ", h("b", null, "Request Mobile Website"), "."));
    }
    render().then(() => {
      flush();
      // Warm the other main screens so switching is instant.
      const warm = () => Object.values(C.routes).forEach((r) => (r.prefetch?.() || []).forEach((p) => C.get(p).catch(() => {})));
      (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => setTimeout(warm, 500));
    });
  };
})();
