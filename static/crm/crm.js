// Sanjay's CRM: phone-first front end for /api/crm. No dependencies.
// Built around the sales system: 60 touches a day, the 5-minute rule, the 3 Gates, EOI -> commission paid.
(() => {
  "use strict";
  const GST = 4 * 3600e3;
  const TZ = "Asia/Dubai";
  const AED_PER_USD = 3.6725;
  const view = document.getElementById("view");
  let settings = null;

  // ---------- vocab ----------
  const STATUS = { new: "New", attempting: "Attempting", conversation: "Spoke", meeting_booked: "Meeting booked", meeting_held: "Met",
    qualified: "Qualified", eoi: "EOI", won: "Won", lost: "Lost", dnc: "Do not call" };
  const TEMP = { hot: "Hot", warm: "Warm", nurture: "Nurture", cold: "Cold" };
  const SOURCE = { warm: "Warm network", lyka: "Lyka CRM", content: "Content", linkedin: "LinkedIn", apollo: "Apollo", db: "Owner database",
    portal: "Portal / inbound", referral: "Referral", ads: "Paid ads", other: "Other" };
  const ICP = { nri: "Indian / NRI abroad", upgrader: "Dubai renter → owner", other: "Other" };
  const LANE = { waterfront: "Waterfront / coastal", growth: "Growth corridor (Dubai South)", value: "Best-value launch" };
  const NEED = { rental: "Rental income", growth: "Capital growth", residency: "Residency / Golden Visa", end_use: "Live in it",
    retire: "Retire into", diversify: "Diversify out of India/US", investment: "Investment (unclear)" };
  const COUNTRY = { AE: "UAE", IN: "India", US: "USA", UK: "UK", SA: "Saudi", QA: "Qatar", other: "Other" };
  const COUNTRY_TZ = { AE: "Asia/Dubai", IN: "Asia/Kolkata", US: "America/New_York", UK: "Europe/London", SA: "Asia/Riyadh", QA: "Asia/Qatar" };
  const OUTCOME = { no_answer: "No answer", busy: "Busy", voicemail: "Voicemail", wrong_number: "Wrong number", sent: "Message sent",
    replied: "Replied", conversation: "Spoke", callback: "Call back", booked: "Booked meeting", stay_in_touch: "Stay in touch",
    referral: "Referral", not_interested: "Not interested", dnc_request: "Asked not to call" };
  const STAGES = [["eoi", "EOI"], ["allocation", "Allocation"], ["booking", "Booking"], ["spa", "SPA"], ["oqood", "Oqood"], ["paid", "Commission paid"]];
  const STAGE = Object.fromEntries([...STAGES, ["fell_through", "Fell through"]]);
  const STAGE_DATE = { eoi: "eoi_at", allocation: "allocation_at", booking: "booking_at", spa: "spa_at", oqood: "oqood_at", paid: "commission_paid_at", fell_through: "fell_through_at" };
  const MEET_KIND = { video: "Video call", site_visit: "Site visit", office: "Office", phone: "Phone" };
  const MEET_STATUS = { booked: "Booked", held: "Held", no_show: "No-show", rescheduled: "Rescheduled", cancelled: "Cancelled" };
  const OBJECTIONS = [
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
    { k: "budget", q: "I don't have the budget right now", why: "Access vs allocation",
      move: "No access → nurture with a date. Allocation → realign on value." },
    { k: "busy", q: "I'm travelling / busy", why: "Timing", move: "Reschedule for when they can actually decide." },
  ];
  const OBJ = Object.fromEntries(OBJECTIONS.map((o) => [o.k, o]));

  // ---------- tiny DOM helper (text only, never innerHTML with data) ----------
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
  const svgIcon = (d) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", "18"); s.setAttribute("height", "18"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s; };
  const ICON = {
    call: "M5 4h2l2 5-2.5 1.5a11 11 0 0 0 5 5L13 13l5 2v2a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2",
    wa: "M4 20l1.3-3.9A8 8 0 1 1 8 19z",
    log: "M4 6h16M4 12h10M4 18h7",
    back: "M15 18l-6-6 6-6",
  };

  // ---------- time & money ----------
  const gulf = (iso) => new Date(Date.parse(iso) + GST).toISOString(); // "Gulf wall clock" as an ISO string
  const gulfToday = () => gulf(new Date().toISOString()).slice(0, 10);
  const fromGulf = (date, time = "09:00") => new Date(Date.parse(`${date}T${time}:00+04:00`)).toISOString();
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
  const gulfHour = () => { const g = gulf(new Date().toISOString()); return Number(g.slice(11, 13)) + Number(g.slice(14, 16)) / 60; };
  const fmt = (iso, opts) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts }).format(new Date(iso)) : "");
  const fmtTime = (iso) => fmt(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDay = (iso) => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
  const fmtWhen = (iso) => {
    if (!iso) return "";
    const d = gulf(iso).slice(0, 10), t = gulfToday();
    const time = fmtTime(iso);
    if (d === t) return `Today ${time}`;
    if (d === addDays(t, 1)) return `Tomorrow ${time}`;
    if (d === addDays(t, -1)) return `Yesterday ${time}`;
    return `${fmtDay(iso)} ${time}`;
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
  const usd = (vAed) => { const u = Number(vAed || 0) / AED_PER_USD; return Math.abs(u) >= 1e3 ? `$${(u / 1e3).toFixed(u >= 1e5 ? 0 : 1).replace(/\.0$/, "")}k` : `$${Math.round(u)}`; };
  const both = (vAed) => `${aed(vAed)} (${usd(vAed)})`;
  const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`);
  // Agency commission by developer (Settings), falling back to the default rate.
  const devPct = (dev) => {
    const k = String(dev || "").trim().toLowerCase();
    const hit = k && (settings?.developer_commissions || []).find((x) => String(x.developer || "").trim().toLowerCase() === k);
    return hit ? Number(hit.pct) : null;
  };
  const netOf = (d) => (Number(d.price_aed) || 0) * (Number(d.commission_pct) || 0) / 100 * (Number(d.split_pct) || 0) / 100;
  const first = (name) => String(name || "").trim().split(/\s+/)[0] || "";
  const digits = (p) => String(p || "").replace(/\D/g, "");
  const isUae = (l) => l.country === "AE" || String(l.phone || "").startsWith("+971");
  const localTime = (l) => {
    const tz = COUNTRY_TZ[l.country];
    if (!tz || tz === TZ) return null;
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  };
  const localHour = (l) => {
    const tz = COUNTRY_TZ[l.country] || TZ;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date());
    return Number(parts) % 24;
  };

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(`/api/crm/${path}`, {
      method: opts.method || "GET", credentials: "same-origin",
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { location.reload(); throw new Error("Signed out"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  const loadSettings = async () => (settings = (await api("settings")).settings);

  // ---------- toast & sheets ----------
  const toastEl = document.getElementById("toast");
  let toastTimer;
  function toast(msg, action) {
    toastEl.replaceChildren(h("span", null, msg), ...(action ? [h("button", { type: "button", onclick: () => { toastEl.classList.remove("on"); action.fn(); } }, action.label)] : []));
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("on"), action ? 6000 : 2600);
  }
  const fail = (e) => toast(e.message || "Something went wrong");

  let sheetStack = [];
  function sheet(title, body, footer) {
    const close = () => { wrap.remove(); sheetStack = sheetStack.filter((s) => s !== close); if (!sheetStack.length) document.body.classList.remove("sheet-open"); };
    const wrap = h("div", { class: "sheet-wrap", onclick: (e) => { if (e.target === wrap) close(); } },
      h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "sheet-h" }, h("h2", null, title), h("button", { class: "x", type: "button", "aria-label": "Close", onclick: close }, "✕")),
        h("div", { class: "sheet-b" }, body),
        footer ? h("div", { class: "sheet-f" }, footer) : null));
    document.body.append(wrap);
    document.body.classList.add("sheet-open");
    sheetStack.push(close);
    setTimeout(() => { if (!wrap.contains(document.activeElement)) wrap.querySelector("input:not([type=hidden]):not([type=checkbox]), textarea")?.focus({ preventScroll: true }); }, 50);
    return close;
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetStack.length) sheetStack[sheetStack.length - 1](); });

  // ---------- form builder ----------
  // spec: { k, label, type, options: [[value,label]], num, half, hint, placeholder, required }
  function form(specs, values = {}) {
    const getters = {};
    const el = h("div", { class: "form" });
    for (const sp of specs) {
      if (sp.type === "heading") { el.append(h("h3", { class: "fh" }, sp.label), sp.hint ? h("p", { class: "fhint" }, sp.hint) : null); continue; }
      if (sp.type === "note") { el.append(h("p", { class: "fhint" }, sp.label)); continue; }
      const v = values[sp.k];
      const id = `f-${sp.k}-${Math.random().toString(36).slice(2, 7)}`;
      let input;
      const label = h("label", { for: id }, sp.label, sp.required ? h("span", { class: "req" }, " *") : null);
      if (sp.type === "chips" || sp.type === "multi" || sp.type === "pass") {
        const opts = sp.type === "pass" ? [["1", "Passed ✓"], ["0", "Not passed"]] : sp.options;
        const multi = sp.type === "multi";
        let cur = multi ? new Set(Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch (e) { return []; } })()) : (v == null ? "" : String(v));
        const group = h("div", { class: "chips-f pick", role: multi ? "group" : "radiogroup", id });
        const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(multi ? cur.has(b.dataset.v) : cur === b.dataset.v)));
        for (const [ov, ol] of opts) {
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
        const quick = sp.quick ? h("div", { class: "chips-f" }, sp.quick.map(([ql, qd, qt]) => h("button", { type: "button", onclick: () => { d.value = qd; t.value = qt; } }, ql))) : null;
        getters[sp.k] = () => (d.value ? fromGulf(d.value, t.value || "09:00") : null);
        el.append(h("div", { class: "fld" }, label, h("div", { class: "dt" }, d, t), quick, sp.hint ? h("small", null, sp.hint) : null));
        continue;
      }
      if (sp.type === "date") {
        input = h("input", { type: "date", id, value: v ? (v.length > 10 ? gulf(v).slice(0, 10) : v) : "" });
        getters[sp.k] = () => (input.value ? (sp.iso ? fromGulf(input.value, "12:00") : input.value) : null);
      } else if (sp.type === "select") {
        input = h("select", { id }, h("option", { value: "" }, sp.placeholder || "—"), sp.options.map(([ov, ol]) => h("option", { value: String(ov) }, ol)));
        input.value = v == null ? "" : String(v);
        getters[sp.k] = () => (input.value === "" ? null : sp.num ? Number(input.value) : input.value);
      } else if (sp.type === "textarea") {
        input = h("textarea", { id, rows: sp.rows || 3, placeholder: sp.placeholder || "", value: v ?? "" });
        getters[sp.k] = () => input.value.trim() || null;
      } else {
        const t = sp.type === "money" ? "number" : sp.type || "text";
        input = h("input", { id, type: t, inputmode: sp.type === "money" || sp.type === "number" ? "decimal" : sp.type === "tel" ? "tel" : null,
          placeholder: sp.placeholder || "", value: v ?? "", step: sp.step || (t === "number" ? "any" : null),
          autocomplete: sp.autocomplete || "off", autocapitalize: sp.type === "email" ? "none" : null });
        getters[sp.k] = () => { const x = input.value.trim(); if (x === "") return null; return t === "number" ? Number(x) : x; };
      }
      if (sp.oninput) input.addEventListener("input", () => sp.oninput(getters[sp.k]()));
      el.append(h("div", { class: `fld${sp.half ? " half" : ""}` }, label, input, sp.hint ? h("small", null, sp.hint) : null));
    }
    return { el, get: () => Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()])) };
  }
  const opts = (obj) => Object.entries(obj);

  // ---------- calling: compliance guard, tel/wa links, auto log on return ----------
  const PENDING = "crm-pending-call";
  function guard(lead) {
    const out = { block: null, warn: [] };
    if (lead.status === "dnc") out.block = "They asked not to be called. Don't call this number.";
    const [startH, endH] = (settings && settings.calling_hours) || [9, 18];
    if (isUae(lead)) {
      if (lead.dncr === "listed") out.block = "This UAE number is on the Do Not Call Registry.";
      const hr = gulfHour();
      if (!out.block && (hr < startH || hr >= endH)) out.block = `UAE rules: calls to UAE numbers only ${startH} AM–${endH - 12} PM Gulf time. It's ${fmtTime(new Date().toISOString())} now.`;
      if (!out.block && lead.dncr !== "clear") out.warn.push("DNCR not checked for this UAE number yet.");
    } else {
      const lh = localHour(lead);
      if (lh < 9 || lh >= 21) out.warn.push(`It's ${localTime(lead) || fmtTime(new Date().toISOString())} for them.`);
    }
    if (lead.last_no_at && gulf(lead.last_no_at).slice(0, 10) === gulfToday()) {
      const msg = "They said no today. No same-day call back.";
      if (isUae(lead)) out.block = out.block || msg; else out.warn.push(msg);
    }
    return out;
  }
  function startCall(lead) {
    if (!lead.phone) return toast("No phone number saved");
    const g = guard(lead);
    const go = () => {
      try { sessionStorage.setItem(PENDING, JSON.stringify({ id: lead.id, channel: "call", at: Date.now() })); } catch (e) { /* ignore */ }
      location.href = `tel:${lead.phone}`;
      // Desktop (no phone app): open the log straight away.
      setTimeout(() => { if (document.visibilityState === "visible") resumeLog(); }, 1500);
    };
    if (g.block) {
      const close = sheet("Hold on", h("div", null, h("p", { class: "warnbox" }, g.block)),
        [h("button", { class: "btn", type: "button", onclick: () => { close(); followUpSheet(lead); } }, "Schedule instead"),
         h("button", { class: "btn ghost", type: "button", onclick: () => close() }, "OK")]);
      return;
    }
    if (g.warn.length) {
      const dncrBtns = isUae(lead) && lead.dncr !== "clear" ? [
        h("button", { class: "btn", type: "button", onclick: async () => { await api(`leads/${lead.id}`, { method: "PATCH", body: { dncr: "clear" } }); lead.dncr = "clear"; close(); go(); } }, "Checked: not on DNCR, call"),
        h("button", { class: "btn danger", type: "button", onclick: async () => { await api(`leads/${lead.id}`, { method: "PATCH", body: { dncr: "listed" } }); close(); toast("Marked as on the DNCR"); refresh(); } }, "It's on the DNCR"),
      ] : [h("button", { class: "btn", type: "button", onclick: () => { close(); go(); } }, "Call anyway")];
      const close = sheet("Before you call", h("div", null, g.warn.map((w) => h("p", { class: "warnbox soft" }, w)),
        isUae(lead) && lead.dncr !== "clear" ? h("p", { class: "fhint" }, "Check the number on the DNCR (ask Lyka for the process), then confirm here once. Fines run to AED 50,000.") : null),
        [...dncrBtns, h("button", { class: "btn ghost", type: "button", onclick: () => close() }, "Cancel")]);
      return;
    }
    go();
  }
  function fill(text, lead, extra = {}) {
    return text.replace(/\{first\}/g, first(lead.name)).replace(/\{name\}/g, lead.name || "")
      .replace(/\{time\}/g, extra.time || "").replace(/\{day\}/g, extra.day || "");
  }
  function startWhatsApp(lead, extra = {}) {
    const num = digits(lead.whatsapp || lead.phone);
    if (!num) return toast("No WhatsApp number saved");
    if (lead.status === "dnc") return toast("They asked not to be contacted");
    const send = (text) => {
      try { sessionStorage.setItem(PENDING, JSON.stringify({ id: lead.id, channel: "whatsapp", at: Date.now() })); } catch (e) { /* ignore */ }
      close();
      window.open(`https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank", "noopener");
    };
    const tpl = (settings?.templates || []);
    const close = sheet(`WhatsApp ${first(lead.name)}`, h("div", { class: "tpls" },
      tpl.map((t) => { const text = fill(t.text, lead, extra); return h("button", { class: "tpl", type: "button", onclick: () => send(text) }, h("b", null, t.name), h("span", null, text)); }),
      h("button", { class: "tpl", type: "button", onclick: () => send("") }, h("b", null, "Blank message"), h("span", null, "Open the chat and type your own."))));
  }
  function resumeLog() {
    let p;
    try { p = JSON.parse(sessionStorage.getItem(PENDING) || "null"); sessionStorage.removeItem(PENDING); } catch (e) { p = null; }
    if (!p || Date.now() - p.at > 3 * 3600e3) return;
    api(`leads/${p.id}`).then((d) => logSheet(d.lead, p.channel)).catch(() => {});
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(resumeLog, 300); });

  // ---------- the 5-second call log ----------
  const quickDays = () => {
    const t = gulfToday();
    return [["Tomorrow", addDays(t, 1), "10:00"], ["In 3 days", addDays(t, 3), "10:00"], ["In a week", addDays(t, 7), "10:00"], ["In a month", addDays(t, 30), "10:00"]];
  };
  const DEFAULT_NEXT = { no_answer: 1, busy: 1, voicemail: 1, sent: 2, replied: 1, conversation: 3, callback: 1, stay_in_touch: 30, referral: 30 };
  function logSheet(lead, channel = "call") {
    let outcome = null, nos = 0, nextIso = null, nextTouched = false;
    const callOutcomes = [["no_answer", "No answer"], ["busy", "Busy"], ["wrong_number", "Wrong number"]];
    const waOutcomes = [["sent", "Sent, no reply"], ["replied", "Replied"]];
    const reached = [["booked", "Booked meeting"], ["stay_in_touch", "Stay in touch"], ["referral", "Gave a referral"],
      ["callback", "Call back later"], ["conversation", "Spoke, no outcome"], ["not_interested", "Not interested at all"], ["dnc_request", "Don't contact me"]];
    const chan = h("div", { class: "seg wide" }, [["call", "Call"], ["whatsapp", "WhatsApp"], ["email", "Email"]].map(([v, l]) =>
      h("button", { type: "button", "aria-pressed": String(v === channel), onclick: (e) => { channel = v; chan.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); paintOutcomes(); } }, l)));
    const outWrap = h("div");
    const nextLbl = h("p", { class: "fhint" });
    const nextDate = h("input", { type: "date" }), nextTime = h("input", { type: "time", value: "10:00", step: 300 });
    const setNext = (d, t) => { nextDate.value = d || ""; if (t) nextTime.value = t; nextIso = d ? fromGulf(d, nextTime.value || "10:00") : null; nextLbl.textContent = nextIso ? `Next touch: ${fmtWhen(nextIso)}` : "No follow-up"; };
    nextDate.addEventListener("input", () => { nextTouched = true; setNext(nextDate.value); });
    nextTime.addEventListener("input", () => { nextTouched = true; setNext(nextDate.value); });
    const nextBox = h("div", { class: "fld" }, h("label", null, "Follow up"),
      h("div", { class: "chips-f" }, quickDays().map(([l, d, t]) => h("button", { type: "button", onclick: () => { nextTouched = true; setNext(d, t); } }, l)),
        h("button", { type: "button", onclick: () => { nextTouched = true; setNext(null); } }, "None")),
      h("div", { class: "dt" }, nextDate, nextTime), nextLbl);
    const nosRow = h("div", { class: "fld" }, h("label", null, "Nos before hanging up (leave after three)"),
      h("div", { class: "chips-f pick" }, [0, 1, 2, 3].map((n) => h("button", { type: "button", "aria-pressed": String(n === 0), onclick: (e) => { nos = n; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, String(n)))));
    const note = h("textarea", { rows: 2, placeholder: "What did they say? (need, timing, who decides)" });
    const lostReason = h("input", { type: "text", placeholder: "Why? (optional)" });
    const lostBox = h("div", { class: "fld", hidden: true }, h("label", null, "Reason"), lostReason);
    const nurtureReason = h("input", { type: "text", placeholder: "Real later reason: bonus in March, RSUs vesting…" });
    const nurtureBox = h("div", { class: "fld", hidden: true }, h("label", null, "Their reason for later"), nurtureReason);
    const pick = (v, btn) => {
      outcome = v;
      outWrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      const terminal = ["wrong_number", "not_interested", "dnc_request", "booked"].includes(v);
      nextBox.hidden = terminal;
      lostBox.hidden = v !== "not_interested";
      nurtureBox.hidden = v !== "stay_in_touch";
      if (!nextTouched) {
        if (terminal) setNext(null);
        else { const n = DEFAULT_NEXT[v] ?? 2; const fewNo = v === "no_answer" && (lead.touch_count || 0) >= 3 ? 3 : n; setNext(addDays(gulfToday(), fewNo), "10:00"); }
      }
      saveBtn.disabled = false;
      saveBtn.textContent = v === "booked" ? "Save & book the meeting" : v === "referral" ? "Save & add the referral" : "Save";
    };
    const group = (title, list) => h("div", null, h("small", { class: "glabel" }, title),
      h("div", { class: "outs" }, list.map(([v, l]) => h("button", { type: "button", class: `out o-${v}`, onclick: (e) => pick(v, e.currentTarget) }, l))));
    function paintOutcomes() {
      outWrap.replaceChildren(group(channel === "call" ? "Didn't reach" : "No conversation", channel === "call" ? callOutcomes : waOutcomes), group("Reached them", reached));
      outcome = null; saveBtn.disabled = true;
    }
    const saveBtn = h("button", { class: "btn", type: "button", disabled: true, onclick: async () => {
      if (!outcome) return;
      saveBtn.disabled = true;
      try {
        const res = await api("touches", { method: "POST", body: { lead_id: lead.id, channel, outcome, nos, note: note.value.trim() || null,
          next_action_at: nextBox.hidden ? null : nextIso, next_action: nextBox.hidden || !nextIso ? null : (outcome === "callback" ? "Call back" : "Follow up"),
          lost_reason: lostReason.value.trim() || null, nurture_reason: nurtureReason.value.trim() || null } });
        close();
        toast(`${OUTCOME[outcome]} logged`, { label: "Undo", fn: async () => { await api(`touches/${res.touch.id}`, { method: "DELETE" }); toast("Removed"); refresh(); } });
        if (outcome === "booked") bookSheet(res.lead);
        else if (outcome === "referral") leadSheet({ source: "referral", referred_by: lead.id, source_detail: `Referred by ${lead.name}` });
        refresh();
      } catch (e) { saveBtn.disabled = false; fail(e); }
    } }, "Save");
    paintOutcomes();
    const close = sheet(`Log: ${lead.name}`, h("div", null,
      lead.phone ? h("p", { class: "fhint" }, `${lead.phone}${lead.touch_count ? ` · ${lead.touch_count} earlier touches` : ""}${lead.last_outcome ? ` · last: ${OUTCOME[lead.last_outcome] || lead.last_outcome}` : ""}`) : null,
      chan, outWrap, nurtureBox, lostBox, nosRow, nextBox, h("div", { class: "fld" }, h("label", null, "Note"), note)), [saveBtn]);
  }

  function followUpSheet(lead) {
    const f = form([
      { k: "next_action", label: "What", placeholder: "Call back", type: "text" },
      { k: "next_action_at", label: "When", type: "datetime", defaultTime: "10:00", quick: quickDays() },
    ], { next_action: lead.next_action || "Call back", next_action_at: lead.next_action_at });
    const close = sheet(`Follow up: ${lead.name}`, f.el, [h("button", { class: "btn", type: "button", onclick: async () => {
      try { await api(`leads/${lead.id}`, { method: "PATCH", body: f.get() }); close(); toast("Follow-up set"); refresh(); } catch (e) { fail(e); }
    } }, "Save")]);
  }

  // ---------- lead form ----------
  function leadSheet(lead = {}, onSaved) {
    const editing = !!lead.id;
    const main = form([
      { k: "name", label: "Name", required: true, autocomplete: "name" },
      { k: "phone", label: "Phone", type: "tel", placeholder: "+971 50… / +91… / +1…", half: true },
      { k: "whatsapp", label: "WhatsApp (if different)", type: "tel", half: true },
      { k: "country", label: "Country", type: "select", options: opts(COUNTRY), half: true, hint: "Filled from the number if left blank" },
      { k: "city", label: "City", half: true },
      { k: "icp", label: "Buyer type", type: "chips", options: opts(ICP) },
      { k: "source", label: "Source", type: "chips", options: opts(SOURCE) },
      { k: "source_detail", label: "Source detail", placeholder: "Which list, post, launch campaign or portal" },
      ...(editing ? [] : [{ k: "inbound", label: "They contacted me (inbound)", type: "chips", options: [["1", "Yes: start the 5-minute timer"], ["0", "No, I'm reaching out"]], num: true }]),
      { k: "temperature", label: "Temperature", type: "chips", options: opts(TEMP) },
      { k: "email", label: "Email", type: "email", half: true },
      { k: "job_title", label: "Job title", half: true },
      { k: "company", label: "Company", half: true },
      { k: "tags", label: "Tags", half: true, placeholder: "H-1B, Tamil, Golden Visa" },
      { k: "notes", label: "Notes", type: "textarea" },
    ], { icp: "nri", source: "other", temperature: "warm", inbound: 0, ...lead });
    let extra = null;
    if (editing) {
      extra = form([
        { type: "heading", label: "Qualification" },
        { k: "status", label: "Stage", type: "select", options: opts(STATUS), half: true },
        { k: "dncr", label: "DNCR (UAE numbers)", type: "select", options: [["unknown", "Not checked"], ["clear", "Checked: clear"], ["listed", "On the registry"]], half: true },
        { k: "lane", label: "Lane", type: "chips", options: opts(LANE) },
        { k: "need", label: "Real goal", type: "chips", options: opts(NEED) },
        { k: "budget_min", label: "Budget from (AED)", type: "money", half: true },
        { k: "budget_max", label: "Budget to (AED)", type: "money", half: true },
        { k: "funding", label: "Funding", type: "chips", options: [["cash", "Cash"], ["mortgage", "Mortgage"], ["mixed", "Mixed"]] },
        { k: "decision_makers", label: "Who decides", placeholder: "Wife, parents, business partner" },
        { k: "timeline", label: "Timeline", placeholder: "This launch / Q1 / after bonus" },
        { k: "nurture_reason", label: "Nurture reason" },
        { k: "lost_reason", label: "Lost reason" },
        { k: "next_action", label: "Next action", half: true },
        { k: "next_action_at", label: "Next action when", type: "datetime", quick: quickDays() },
      ], lead);
    }
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const body = { ...main.get(), ...(extra ? extra.get() : {}) };
      if (!body.name) return toast("Name is required");
      if (lead.referred_by && !editing) body.referred_by = lead.referred_by;
      if (body.inbound) { body.next_action = "Call within 5 minutes"; body.next_action_at = new Date().toISOString(); body.temperature = body.temperature || "hot"; }
      saveBtn.disabled = true;
      try {
        const res = editing ? await api(`leads/${lead.id}`, { method: "PATCH", body }) : await api("leads", { method: "POST", body });
        close();
        toast(editing ? "Saved" : "Lead added");
        if (onSaved) onSaved(res.lead); else if (!editing) location.hash = `lead/${res.lead.id}`; else refresh();
      } catch (e) {
        saveBtn.disabled = false;
        if (e.status === 409 && e.data?.duplicate) toast(e.message, { label: "Open", fn: () => { close(); location.hash = `lead/${e.data.duplicate.id}`; } });
        else fail(e);
      }
    } }, editing ? "Save" : "Add lead");
    const close = sheet(editing ? `Edit ${lead.name}` : lead.referred_by ? "Add the referral" : "New lead", h("div", null, main.el, extra ? extra.el : null), [saveBtn]);
  }

  // ---------- meetings ----------
  function slotQuick() {
    const t = gulfToday();
    return [["Tomorrow 11:00", addDays(t, 1), "11:00"], ["Tomorrow 19:00", addDays(t, 1), "19:00"], [`${fmtDay(fromGulf(addDays(t, 2)))} 11:00`, addDays(t, 2), "11:00"],
      [`${fmtDay(fromGulf(addDays(t, 2)))} 14:00`, addDays(t, 2), "14:00"]];
  }
  function bookSheet(lead, meeting = null) {
    const f = form([
      { type: "note", label: "Offer two slots, never “when are you free?”. Don't hang up until the invite is on their calendar." },
      { k: "scheduled_at", label: "When (Gulf time)", type: "datetime", defaultTime: "11:00", quick: slotQuick() },
      { k: "kind", label: "Type", type: "chips", options: opts(MEET_KIND), required: true },
      { k: "decision_maker_joining", label: "Is the decision-maker joining?", type: "chips", options: [["1", "Yes"], ["0", "No: book them in"]], num: true,
        hint: "B2C: no decision-maker on the call, no call." },
      { k: "attendees", label: "Who's joining", placeholder: "Ravi + wife Priya" },
      { k: "notes", label: "Notes for the call", type: "textarea", placeholder: "What they told you on the cold call" },
    ], meeting || { kind: "video" });
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const body = f.get();
      if (!body.scheduled_at) return toast("Pick a date and time");
      saveBtn.disabled = true;
      try {
        const res = meeting ? await api(`meetings/${meeting.id}`, { method: "PATCH", body: { ...body, status: "booked" } })
          : await api("meetings", { method: "POST", body: { ...body, lead_id: lead.id } });
        close();
        afterBooking(lead, res.meeting);
        refresh();
      } catch (e) { saveBtn.disabled = false; fail(e); }
    } }, meeting ? "Reschedule" : "Book meeting");
    const close = sheet(meeting ? `Reschedule: ${lead.name}` : `Book: ${lead.name}`, f.el, [saveBtn]);
  }
  function icsFor(lead, m) {
    const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sanjay CRM//EN", "BEGIN:VEVENT", `UID:crm-meeting-${m.id}@sanjay-crm`,
      `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(m.scheduled_at)}`, "DURATION:PT30M",
      `SUMMARY:${(MEET_KIND[m.kind] || "Meeting")}: ${lead.name} · Dubai off-plan shortlist`.replace(/[,;]/g, " "),
      `DESCRIPTION:Sanjay (Lyka Realty) · ${lead.phone || ""}`.replace(/[,;]/g, " "),
      "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", "DESCRIPTION:Send the WhatsApp reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
    return new Blob([lines.join("\r\n")], { type: "text/calendar" });
  }
  function downloadIcs(lead, m) {
    const a = h("a", { href: URL.createObjectURL(icsFor(lead, m)), download: `meeting-${first(lead.name)}.ics` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function afterBooking(lead, m) {
    const close = sheet("Meeting booked ✓", h("div", null,
      h("p", null, h("b", null, fmtWhen(m.scheduled_at)), ` · ${MEET_KIND[m.kind] || m.kind}`),
      h("p", { class: "fhint" }, "Before you hang up: calendar invite accepted, WhatsApp saved, reminder the morning of the call."),
      h("div", { class: "stack" },
        h("button", { class: "btn", type: "button", onclick: () => downloadIcs(lead, m) }, "Add to calendar (.ics)"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { close(); startWhatsApp(lead, { time: fmtTime(m.scheduled_at), day: fmtDay(m.scheduled_at) }); } }, "WhatsApp confirmation"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { close(); location.hash = `meeting/${m.id}`; } }, "Open meeting prep"))));
  }

  // ---------- deals ----------
  async function dealSheet(lead, deal = null, meetingId = null) {
    const inv = (await api("inventory").catch(() => ({ inventory: [] }))).inventory.filter((i) => i.status === "active");
    const d = deal || { stage: "eoi", commission_pct: settings.commission_pct, split_pct: settings.split_pct, lane: lead.lane, eoi_refundable: 1 };
    let commTouched = !!deal;
    const netEl = h("p", { class: "netcalc" });
    let f;
    const paintNet = () => { const v = f.get(); const n = netOf(v); netEl.replaceChildren("Your net: ", h("b", null, both(n)), v.price_aed ? ` · ${v.commission_pct || 0}% × ${v.split_pct || 0}% of ${aed(v.price_aed)}` : ""); };
    f = form([
      ...(inv.length ? [{ k: "inventory_id", label: "From your Launch Filter", type: "select", num: true, placeholder: "Pick a project (optional)",
        options: inv.map((i) => [i.id, `${i.project}${i.developer ? ` · ${i.developer}` : ""}`]) }] : []),
      { k: "project", label: "Project", half: true }, { k: "developer", label: "Developer", half: true, oninput: (v) => autoComm(devPct(v)) },
      { k: "unit", label: "Unit", half: true, placeholder: "V-214, 4BR" },
      { k: "lane", label: "Lane", type: "select", options: opts(LANE), half: true },
      { k: "price_aed", label: "Price (AED)", type: "money", oninput: () => paintNet() },
      { k: "commission_pct", label: "Agency commission %", type: "number", half: true, step: "0.1", oninput: () => { commTouched = true; paintNet(); },
        hint: "Set by the developer (5–8%). Filled from the project or developer." },
      { k: "split_pct", label: "Your split %", type: "number", half: true, step: "1", oninput: () => paintNet(), hint: "Lyka's split" },
      { k: "stage", label: "Stage", type: "chips", options: [...STAGES, ["fell_through", "Fell through"]], required: true },
      { k: "eoi_amount", label: "EOI / booking deposit (AED)", type: "money", half: true },
      { k: "eoi_refundable", label: "EOI refundable?", type: "chips", options: [["1", "Yes"], ["0", "No"]], num: true, half: true },
      { type: "heading", label: "Dates", hint: "Filled in automatically when you move the stage. Edit if needed." },
      { k: "eoi_at", label: "EOI", type: "date", iso: true, half: true }, { k: "allocation_at", label: "Allocation", type: "date", iso: true, half: true },
      { k: "booking_at", label: "Booking (counts as closed)", type: "date", iso: true, half: true }, { k: "spa_at", label: "SPA signed", type: "date", iso: true, half: true },
      { k: "oqood_at", label: "Oqood registered", type: "date", iso: true, half: true },
      { k: "commission_expected_at", label: "Commission expected", type: "date", iso: true, half: true, hint: "Developers usually pay after the first instalment + registration (1–3 months)" },
      { k: "commission_paid_at", label: "Commission paid", type: "date", iso: true, half: true },
      { k: "commission_paid_aed", label: "Amount you received (AED)", type: "money", half: true },
      { k: "fell_through_reason", label: "If it fell through: why" },
      { k: "notes", label: "Notes", type: "textarea" },
    ], d);
    const inputFor = (k) => [...f.el.querySelectorAll(".fld")].find((x) => x.querySelector("label")?.textContent.startsWith(k))?.querySelector("input, select");
    function autoComm(pct) {
      const inp = inputFor("Agency commission");
      if (commTouched || !inp) return;
      inp.value = pct ?? settings.commission_pct; paintNet();
    }
    const invSel = f.el.querySelector("select");
    if (inv.length && invSel) invSel.addEventListener("change", () => {
      const i = inv.find((x) => String(x.id) === invSel.value); if (!i) return;
      const set = (k, v) => { const el = [...f.el.querySelectorAll(".fld")].find((x) => x.querySelector("label")?.textContent.startsWith(k)); const inp = el?.querySelector("input, select"); if (inp && !inp.value && v != null) inp.value = v; };
      set("Project", i.project); set("Developer", i.developer); set("Lane", i.lane); set("Price", i.price_from_aed);
      autoComm(i.commission_pct ?? devPct(i.developer)); paintNet();
    });
    paintNet();
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      saveBtn.disabled = true;
      try {
        const body = f.get();
        if (deal) await api(`deals/${deal.id}`, { method: "PATCH", body });
        else await api("deals", { method: "POST", body: { ...body, lead_id: lead.id, meeting_id: meetingId } });
        close(); toast(deal ? "Deal saved" : "Deal added: EOI 🎉"); refresh();
      } catch (e) { saveBtn.disabled = false; fail(e); }
    } }, deal ? "Save deal" : "Add deal");
    const del = deal ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => {
      if (!confirm("Delete this deal?")) return; await api(`deals/${deal.id}`, { method: "DELETE" }); close(); toast("Deal deleted"); refresh();
    } }, "Delete") : null;
    const close = sheet(deal ? `${lead.name}: ${deal.project || "deal"}` : `New deal: ${lead.name}`, h("div", null, netEl, f.el), [saveBtn, del]);
  }
  async function advanceDeal(deal) {
    const order = STAGES.map((s) => s[0]);
    const nxt = order[order.indexOf(deal.stage) + 1];
    if (!nxt) return;
    try { await api(`deals/${deal.id}`, { method: "PATCH", body: { stage: nxt } }); toast(`Moved to ${STAGE[nxt]}`); refresh(); } catch (e) { fail(e); }
  }

  // ---------- shared row pieces ----------
  function paintTimer(el) {
    const m = (Date.now() - Date.parse(el.dataset.since)) / 6e4;
    el.textContent = m < 60 ? `waiting ${m < 1 ? "<1" : Math.floor(m)} min` : `waiting since ${fmtWhen(el.dataset.since)}`;
    el.classList.toggle("over", m > 5);
    return el;
  }
  const tempDot = (t) => h("i", { class: `dot t-${t || "warm"}`, title: TEMP[t] || "" });
  function actions(lead) {
    return h("div", { class: "acts" },
      lead.phone ? h("button", { class: "ab call", type: "button", "aria-label": `Call ${lead.name}`, onclick: (e) => { e.preventDefault(); startCall(lead); } }, svgIcon(ICON.call)) : null,
      (lead.whatsapp || lead.phone) ? h("button", { class: "ab wa", type: "button", "aria-label": `WhatsApp ${lead.name}`, onclick: (e) => { e.preventDefault(); startWhatsApp(lead); } }, svgIcon(ICON.wa)) : null,
      h("button", { class: "ab", type: "button", "aria-label": `Log a touch for ${lead.name}`, onclick: (e) => { e.preventDefault(); logSheet(lead); } }, svgIcon(ICON.log)));
  }
  function leadRow(l, mode) {
    const bits = [];
    if (mode === "inbound") bits.push(paintTimer(h("span", { class: "timer", "data-since": l.inbound_at })));
    if (l.next_action_at && mode !== "fresh") bits.push(h("span", { class: Date.parse(l.next_action_at) < Date.now() ? "late" : "" }, `${l.next_action || "Follow up"} · ${fmtWhen(l.next_action_at)}`));
    if (l.last_outcome) bits.push(`${OUTCOME[l.last_outcome] || l.last_outcome} ${ago(l.last_touch_at)}`);
    if (!l.last_outcome) bits.push(SOURCE[l.source] || l.source || "");
    const lt = localTime(l);
    if (lt) bits.push(`${lt} their time`);
    return h("div", { class: "lrow" },
      h("a", { href: `#lead/${l.id}`, class: "lmain" },
        h("b", null, tempDot(l.temperature), l.name, l.status && !["new", "attempting"].includes(l.status) ? h("span", { class: `st s-${l.status}` }, STATUS[l.status]) : null),
        h("small", null, bits.filter(Boolean).flatMap((b, i) => (i ? [" · ", b] : [b])))),
      actions(l));
  }
  const card = (title, sub, ...kids) => h("div", { class: "card" }, h("h2", null, title, sub != null ? h("small", null, sub) : null), ...kids);
  const bar = (n, target, label) => {
    const p = target ? Math.min(1, n / target) : 0;
    return h("div", { class: "kbar" }, h("div", { class: "kl" }, h("span", null, label), h("b", null, `${n ?? 0}`, h("em", null, ` / ${target}`))),
      h("div", { class: "track" }, h("span", { class: p >= 1 ? "full" : "", style: `width:${(p * 100).toFixed(1)}%` })));
  };
  const empty = (text, ...kids) => h("div", { class: "empty-state" }, h("p", null, text), ...kids);
  const back = (href, label) => h("a", { class: "back", href }, svgIcon(ICON.back), label);
  const header = (title, sub, right) => h("header", { class: "top crm-top" }, h("div", null, h("h1", null, title), sub ? h("p", { class: "sub" }, sub) : null), right || null);

  function scheduleNow() {
    const hr = gulfHour();
    const blocks = [[8, 9, "Prep: today's list, launch updates, one piece of content"], [9, 11.5, "Calling block 1: 30 dials, phone only"],
      [11.5, 13, "Meetings, site visits, filming"], [13, 14, "Follow-ups: WhatsApp, emails, CRM"], [14, 16.5, "Calling block 2: 30 dials"],
      [16.5, 18, "Meetings + inbound (still legal calling hours)"], [18, 23, "Post content · WhatsApp NRIs (US mornings) · 30 min practice"]];
    const b = blocks.find(([a, z]) => hr >= a && hr < z);
    return b ? b[2] : "Off hours. Any inbound lead still gets a call within 5 minutes.";
  }

  // ---------- views ----------
  async function vToday() {
    const t = await api("today");
    settings = t.settings;
    const s = t.settings;
    const touches = t.counts.touches || 0;
    const calling = (() => { const hr = gulfHour(); const [a, z] = s.calling_hours; return hr >= a && hr < z; })();
    const out = [header("Today", `${fmtDay(new Date().toISOString())} · ${fmtTime(new Date().toISOString())} Gulf`,
      h("a", { class: "icon-btn", href: "/", "aria-label": "Back to the Morning Brief" }, svgIcon("M4 6h16M4 12h10M4 18h13")))];
    out.push(h("div", { class: "card hero" },
      h("div", { class: "hero-row" },
        h("div", null, h("small", { class: "eyebrow" }, "Touches today"), h("div", { class: "hero-n" }, String(touches), h("em", null, `/ ${s.daily_touches}`))),
        h("div", { class: "ring-wrap" }, ring(touches / s.daily_touches))),
      h("p", { class: "hero-sub" }, h("span", { class: `pill ${calling ? "up" : "flat"}` }, calling ? "UAE calling hours open" : "UAE calling hours closed"),
        h("span", { class: "muted small" }, `${t.counts.conversations || 0} conversations`)),
      h("p", { class: "block-now" }, scheduleNow())));

    if (t.inbound.length) out.push(card(h("span", { class: "hot-t" }, "🔥 Inbound: call within 5 minutes"), `${t.inbound.length}`, t.inbound.map((l) => leadRow(l, "inbound"))));
    if (t.meetings.length) out.push(card("Meetings today", `${t.meetings.length}`, t.meetings.map((m) => h("div", { class: "lrow" },
      h("a", { href: `#meeting/${m.id}`, class: "lmain" }, h("b", null, `${fmtTime(m.scheduled_at)} · ${m.name}`, m.status === "held" ? h("span", { class: "st s-meeting_held" }, "Held") : null),
        h("small", null, `${MEET_KIND[m.kind] || m.kind}${m.decision_maker_joining ? " · decision-maker joining" : " · ⚠ decision-maker not confirmed"} · tap for prep`)),
      h("div", { class: "acts" }, h("button", { class: "ab wa", type: "button", "aria-label": "Send reminder", onclick: () => startWhatsApp({ ...m, id: m.lead_id, status: "" }, { time: fmtTime(m.scheduled_at), day: fmtDay(m.scheduled_at) }) }, svgIcon(ICON.wa)))))));
    if (t.overdue.length) out.push(card("Overdue follow-ups", `${t.overdue.length}`, t.overdue.map((l) => leadRow(l))));
    if (t.due.length) out.push(card("Due today", `${t.due.length}`, t.due.map((l) => leadRow(l))));
    if (t.hot.length) out.push(card("Hot: no touch this week", `${t.hot.length}`, t.hot.map((l) => leadRow(l))));
    if (t.fresh.length) out.push(card("Next up: fresh numbers", `${t.fresh.length}${t.fresh.length >= 40 ? "+" : ""}`, t.fresh.map((l) => leadRow(l, "fresh"))));
    if (!t.inbound.length && !t.overdue.length && !t.due.length && !t.hot.length && !t.fresh.length) {
      out.push(card("Your call list is empty", null, empty("Pull 300 numbers: warm network, Lyka CRM, engaged content audience.",
        h("div", { class: "stack" }, h("a", { class: "btn", href: "#import" }, "Import a CSV"), h("button", { class: "btn ghost", type: "button", onclick: () => leadSheet() }, "Add a lead")))));
    }
    const w = t.week;
    out.push(card("This week", h("a", { class: "more-link", href: "#numbers" }, "Numbers →"),
      bar(w.touches || 0, s.weekly.touches, "Touches"), bar(w.conversations || 0, s.weekly.conversations, "Conversations"),
      bar(w.booked || 0, s.weekly.booked, "Meetings booked"), bar(w.held || 0, s.weekly.held, "Meetings held"), bar(w.eoi || 0, s.weekly.eoi, "EOI attempts")));
    return out;
  }
  function ring(p) {
    p = Math.max(0, Math.min(1, p || 0));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 44 44"); svg.setAttribute("class", "ring"); svg.setAttribute("aria-hidden", "true");
    const c = (cls, dash) => { const e = document.createElementNS(ns, "circle"); e.setAttribute("cx", "22"); e.setAttribute("cy", "22"); e.setAttribute("r", "18"); e.setAttribute("class", cls);
      if (dash != null) { e.setAttribute("stroke-dasharray", `${dash} 200`); } return e; };
    svg.append(c("rt"), c(p >= 1 ? "rf full" : "rf", (2 * Math.PI * 18 * p).toFixed(1)));
    return svg;
  }

  let leadQuery = { view: "open", q: "", source: "", temperature: "", status: "" };
  async function vLeads() {
    const wrap = h("div");
    const list = h("div", { class: "card list" });
    const count = h("small", { class: "muted" });
    const filters = [["open", "Open"], ["hot", "Hot"], ["nurture", "Nurture"], ["new", "Not called"], ["pipeline", "In pipeline"], ["won", "Won"], ["lost", "Lost"], ["all", "All"]];
    let offset = 0;
    const params = () => {
      const p = new URLSearchParams();
      const f = leadQuery.view;
      if (f === "open" || f === "pipeline") p.set("view", f);
      if (f === "hot" || f === "nurture") { p.set("temperature", f); p.set("view", "open"); }
      if (f === "new") p.set("status", "new");
      if (f === "won") p.set("status", "won");
      if (f === "lost") p.set("status", "lost");
      if (leadQuery.q) p.set("q", leadQuery.q);
      if (leadQuery.source) p.set("source", leadQuery.source);
      if (leadQuery.sort) p.set("sort", leadQuery.sort);
      p.set("limit", "100"); p.set("offset", String(offset));
      return p;
    };
    const load = async (append) => {
      if (!append) offset = 0;
      const res = await api(`leads?${params()}`);
      if (!append) list.replaceChildren();
      list.querySelector(".loadmore")?.remove();
      if (!res.leads.length && !append) list.append(empty(leadQuery.q ? "No lead matches." : "No leads here yet."));
      res.leads.forEach((l) => list.append(leadRow(l)));
      offset += res.leads.length;
      count.textContent = `${res.total} lead${res.total === 1 ? "" : "s"}`;
      if (offset < res.total) list.append(h("button", { class: "btn ghost loadmore", type: "button", onclick: () => load(true) }, `Show more (${res.total - offset} left)`));
    };
    const search = h("input", { id: "q", type: "search", placeholder: "Search name, phone, company, notes", value: leadQuery.q, autocomplete: "off" });
    let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { leadQuery.q = search.value.trim(); load(); }, 250); });
    const chips = h("div", { class: "chips-f" }, filters.map(([v, l]) => h("button", { type: "button", "aria-pressed": String(leadQuery.view === v),
      onclick: (e) => { leadQuery.view = v; chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); load(); } }, l)));
    const src = h("select", { class: "mini", "aria-label": "Source", onchange: (e) => { leadQuery.source = e.target.value; load(); } },
      h("option", { value: "" }, "All sources"), opts(SOURCE).map(([v, l]) => h("option", { value: v }, l)));
    src.value = leadQuery.source;
    const sort = h("select", { class: "mini", "aria-label": "Sort", onchange: (e) => { leadQuery.sort = e.target.value; load(); } },
      [["", "Recent activity"], ["next", "Next follow-up"], ["created", "Newest added"], ["name", "Name A–Z"]].map(([v, l]) => h("option", { value: v }, l)));
    sort.value = leadQuery.sort || "";
    wrap.append(header("Leads", null, h("button", { class: "icon-btn", type: "button", "aria-label": "Add a lead", onclick: () => leadSheet() }, "+")),
      h("div", { class: "card" }, search, chips, h("div", { class: "row2" }, src, sort, count)), list);
    await load();
    return wrap;
  }

  async function vLead(id) {
    const d = await api(`leads/${id}`);
    const l = d.lead;
    const lt = localTime(l);
    const out = [h("div", { class: "crumb" }, back("#leads", "Leads"))];
    const g = guard(l);
    out.push(h("div", { class: "card lead-h" },
      h("div", { class: "lh-top" },
        h("div", null, h("h1", null, tempDot(l.temperature), l.name),
          h("p", { class: "sub" }, [l.phone, l.country ? COUNTRY[l.country] || l.country : null, lt ? `${lt} their time` : null].filter(Boolean).join(" · "))),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Edit lead", onclick: () => leadSheet(l) }, svgIcon("M4 20h4L19 9l-4-4L4 16zM14 6l4 4"))),
      h("div", { class: "tags" }, h("span", { class: `st s-${l.status}` }, STATUS[l.status] || l.status), h("span", { class: "tag" }, TEMP[l.temperature] || "—"),
        h("span", { class: "tag" }, SOURCE[l.source] || l.source), l.icp ? h("span", { class: "tag" }, ICP[l.icp]) : null,
        isUae(l) ? h("span", { class: `tag ${l.dncr === "clear" ? "ok" : l.dncr === "listed" ? "bad" : "warnt"}` }, l.dncr === "clear" ? "DNCR clear" : l.dncr === "listed" ? "On DNCR" : "DNCR not checked") : null,
        l.inbound ? h("span", { class: "tag" }, "Inbound") : null),
      g.block ? h("p", { class: "warnbox" }, g.block) : null,
      h("div", { class: "bigacts" },
        h("button", { class: "btn", type: "button", onclick: () => startCall(l), disabled: !l.phone }, svgIcon(ICON.call), "Call"),
        h("button", { class: "btn ghost", type: "button", onclick: () => startWhatsApp(l), disabled: !(l.phone || l.whatsapp) }, svgIcon(ICON.wa), "WhatsApp"),
        h("button", { class: "btn ghost", type: "button", onclick: () => logSheet(l) }, svgIcon(ICON.log), "Log"))));

    out.push(card("Next action", null,
      l.next_action_at ? h("p", { class: Date.parse(l.next_action_at) < Date.now() ? "late big" : "big" }, `${l.next_action || "Follow up"} · ${fmtWhen(l.next_action_at)}`) : h("p", { class: "muted" }, "Nothing scheduled."),
      h("div", { class: "stack row" },
        h("button", { class: "btn ghost", type: "button", onclick: () => followUpSheet(l) }, "Set follow-up"),
        h("button", { class: "btn ghost", type: "button", onclick: () => bookSheet(l) }, "Book meeting"),
        h("button", { class: "btn ghost", type: "button", onclick: () => dealSheet(l) }, "Add deal"))));

    const facts = [["Real goal", NEED[l.need]], ["Lane", LANE[l.lane]], ["Budget", l.budget_min || l.budget_max ? `${aed(l.budget_min)}–${aed(l.budget_max)}` : null],
      ["Funding", l.funding], ["Who decides", l.decision_makers], ["Timeline", l.timeline], ["Nurture reason", l.nurture_reason], ["Lost reason", l.lost_reason],
      ["Job", [l.job_title, l.company].filter(Boolean).join(", ")], ["City", l.city], ["Email", l.email], ["WhatsApp", l.whatsapp], ["Source detail", l.source_detail],
      ["Referred by", d.referrer ? h("a", { href: `#lead/${d.referrer.id}` }, d.referrer.name) : null], ["Tags", l.tags], ["Added", fmtDay(l.created_at)]].filter(([, v]) => v);
    out.push(card("Profile", null, h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      l.notes ? h("p", { class: "notes" }, l.notes) : null,
      !l.need && !l.lane ? h("p", { class: "fhint" }, "Gates not done yet: book the 30-minute call to find need, decision-maker and budget.") : null));

    if (d.meetings.length) out.push(card("Meetings", `${d.meetings.length}`, d.meetings.map((m) => h("a", { class: "lrow link-row", href: `#meeting/${m.id}` },
      h("div", { class: "lmain" }, h("b", null, fmtWhen(m.scheduled_at), h("span", { class: `st m-${m.status}` }, MEET_STATUS[m.status])),
        h("small", null, [MEET_KIND[m.kind], m.close_score ? `scored ${m.close_score}/10` : null, gatesText(m)].filter(Boolean).join(" · ")))))));
    if (d.deals.length) out.push(card("Deals", `${d.deals.length}`, d.deals.map((x) => h("button", { class: "lrow link-row", type: "button", onclick: () => dealSheet(l, x) },
      h("div", { class: "lmain" }, h("b", null, `${x.project || "Deal"}${x.unit ? ` · ${x.unit}` : ""}`, h("span", { class: `st d-${x.stage}` }, STAGE[x.stage])),
        h("small", null, `${aed(x.price_aed)} · your net ${both(netOf(x))}`))))));
    if (d.referrals.length) out.push(card("Referrals they gave", `${d.referrals.length}`, d.referrals.map((r) => h("a", { class: "lrow link-row", href: `#lead/${r.id}` }, h("div", { class: "lmain" }, h("b", null, r.name), h("small", null, STATUS[r.status]))))));

    out.push(card("History", `${d.touches.length} touches`, d.touches.length ? h("ol", { class: "tl" }, d.touches.map((t) => h("li", null,
      h("div", null, h("b", null, `${t.channel === "whatsapp" ? "WhatsApp" : t.channel === "email" ? "Email" : "Call"}: ${OUTCOME[t.outcome] || t.outcome}`), t.nos ? ` · ${t.nos} no${t.nos > 1 ? "s" : ""}` : "",
        h("small", null, fmtWhen(t.at)), t.note ? h("p", null, t.note) : null),
      h("button", { class: "x", type: "button", "aria-label": "Delete this touch", onclick: async () => { if (!confirm("Delete this touch?")) return; await api(`touches/${t.id}`, { method: "DELETE" }); refresh(); } }, "✕")))) : empty("No touches yet.")));

    out.push(h("div", { class: "card dangerzone" },
      h("div", { class: "stack row" },
        l.status !== "lost" ? h("button", { class: "btn ghost", type: "button", onclick: async () => { const r = prompt("Why is this lead lost?", l.lost_reason || ""); if (r === null) return; await api(`leads/${l.id}`, { method: "PATCH", body: { status: "lost", lost_reason: r, next_action_at: null, next_action: null } }); refresh(); } }, "Mark lost")
          : h("button", { class: "btn ghost", type: "button", onclick: async () => { await api(`leads/${l.id}`, { method: "PATCH", body: { status: "conversation", temperature: "nurture" } }); refresh(); } }, "Reopen"),
        h("button", { class: "btn ghost", type: "button", onclick: async () => { await api(`leads/${l.id}`, { method: "PATCH", body: { status: "dnc", next_action_at: null, next_action: null } }); refresh(); } }, "Do not call"),
        h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!confirm(`Delete ${l.name} and all their history?`)) return; await api(`leads/${l.id}`, { method: "DELETE" }); toast("Deleted"); location.hash = "leads"; } }, "Delete"))));
    return out;
  }
  const gatesText = (m) => (m.status !== "held" ? null : `gates ${["g1_pass", "g2_pass", "g3_pass"].map((g) => (m[g] === 1 ? "✓" : m[g] === 0 ? "✗" : "·")).join("")}`);

  async function vMeeting(id) {
    const { meeting: m } = await api(`meetings/${id}`);
    const lead = { id: m.lead_id, name: m.name, phone: m.phone, whatsapp: m.whatsapp, country: m.country, lane: m.lane };
    const inv = (await api("inventory").catch(() => ({ inventory: [] }))).inventory.filter((i) => i.status === "active" && i.f_delivery && i.f_growth && i.f_payment);
    const objHints = h("div", { class: "objhints" });
    const paintObj = (keys) => objHints.replaceChildren(...(keys || []).map((k) => OBJ[k] ? h("div", { class: "why" }, h("b", null, OBJ[k].why), h("p", null, OBJ[k].move)) : null));
    const f = form([
      { k: "status", label: "Status", type: "chips", options: opts(MEET_STATUS), required: true },
      { type: "heading", label: "0–3 min · Rapport, then context", hint: "“Before I show you anything, I need to understand what you're actually trying to achieve, otherwise I'm just sending you brochures like every other agent. If what we have fits, I'll show you 3 options. If it doesn't, I'll tell you honestly. Fair?”" },
      { type: "heading", label: "Gate 1 · Need (ask why three layers deep)", hint: "Why Dubai, and why now? → Why that area or type? → What does this property need to do for your family in 5 years?" },
      { k: "g1_goal", label: "Real goal", type: "chips", options: opts(NEED) },
      { k: "g1_why", label: "Their why (in their words)", type: "textarea", rows: 2 },
      { k: "g1_tried", label: "Looked at other launches? What stopped them?", type: "textarea", rows: 2 },
      { k: "g1_realign", label: "Beliefs to realign", placeholder: "Guaranteed flips, rental income before handover…" },
      { k: "g1_pass", label: "Gate 1", type: "pass" },
      { type: "heading", label: "Gate 2 · Decision-maker and timeline", hint: "No decision-maker on the call → book the next call with them; don't pitch to half the decision." },
      { k: "g2_decision", label: "Who else needs to be comfortable?", placeholder: "Wife, parents, partner" },
      { k: "g2_dm_present", label: "Decision-maker on this call?", type: "chips", options: [["1", "Yes"], ["0", "No"]], num: true },
      { k: "g2_timeline", label: "Timeline", type: "chips", options: [["hot", "Hot: within this launch window"], ["nurture", "Nurture: real later reason"]] },
      { k: "g2_reason", label: "Reason / date", placeholder: "Bonus in March, RSUs vesting. Fake reason? “What changes after Diwali?”" },
      { k: "g2_pass", label: "Gate 2", type: "pass" },
      { type: "heading", label: "Gate 3 · Budget (never name the price first)", hint: "“What range are you comfortable investing, including the down payment?” Dodge → “Villas here run from [low] to [high]. Where do you sit?”" },
      { k: "g3_budget_min", label: "Budget from (AED)", type: "money", half: true }, { k: "g3_budget_max", label: "Budget to (AED)", type: "money", half: true },
      { k: "g3_down_payment", label: "Down payment available now (AED)", type: "money" },
      { k: "g3_funding", label: "Funding", type: "chips", options: [["cash", "Cash"], ["mortgage", "Mortgage"], ["mixed", "Mixed"]] },
      { k: "g3_access", label: "Too low?", type: "chips", options: [["access", "Has access"], ["allocation", "Has it, won't allocate: show value"], ["no_access", "No access: disqualify kindly / nurture"]] },
      { k: "g3_pass", label: "Gate 3", type: "pass", hint: "Lock it: “If I show you a unit that fits everything you've told me, at around [X] with [Y]% upfront, would you be ready to move on it?”" },
      { type: "heading", label: "15–25 min · Belief-break, proof, pitch", hint: "“How much do you think you need upfront to own an AED 2M villa?” → show the payment plan. Then the Launch Filter + 3 units + process: EOI → allocation → booking → SPA → Oqood → handover → leasing." },
      { k: "lane", label: "Lane", type: "chips", options: opts(LANE) },
      { k: "belief_break", label: "Belief you broke", type: "chips", options: [["upfront", "Upfront needed"], ["allocation", "Hot launch allocation"], ["delays", "Developer delays"], ["other", "Other"]] },
      { k: "units_shown", label: "3 units shown", type: "textarea", rows: 2, placeholder: inv.length ? `Passing your filter: ${inv.slice(0, 4).map((i) => i.project).join(", ")}` : "Project · unit · price · upfront" },
      { type: "heading", label: "25–30 min · Shut up → 1–10 close", hint: "“On a scale of 1 to 10, 1 not for you, 10 lock it in today: where are you?” → “Why not lower?” → “What would make it a 10?”" },
      { k: "close_score", label: "Their score", type: "chips", num: true, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), String(n)]) },
      { k: "why_not_lower", label: "Why not lower (what they love)", type: "textarea", rows: 2 },
      { k: "to_ten", label: "What would make it a 10", type: "textarea", rows: 2 },
      { k: "objections", label: "Objections raised", type: "multi", options: OBJECTIONS.map((o) => [o.k, o.q]), onchange: paintObj },
      { type: "heading", label: "Outcome", hint: "Not today → book the decision call before you hang up. No “I'll get back to you.”" },
      { k: "outcome", label: "Result", type: "chips", options: [["eoi", "EOI / booking deposit"], ["next_call", "Decision call booked"], ["nurture", "Nurture"], ["disqualified", "Disqualified"], ["lost", "Lost"]] },
      { k: "next_call_at", label: "Next call", type: "datetime", defaultTime: "19:00", quick: slotQuick() },
      { k: "notes", label: "Notes", type: "textarea" },
    ], m);
    const objSel = (() => { try { return JSON.parse(m.objections || "[]"); } catch (e) { return []; } })();
    paintObj(objSel);
    const objFld = [...f.el.querySelectorAll(".fld")].find((x) => x.querySelector("label")?.textContent.startsWith("Objections"));
    objFld?.append(objHints);
    const save = async (next) => {
      const body = f.get();
      if (body.outcome && body.status === "booked") body.status = "held";
      try {
        await api(`meetings/${id}`, { method: "PATCH", body });
        toast("Meeting saved");
        if (body.outcome === "eoi") { const ld = await api(`leads/${m.lead_id}`); dealSheet(ld.lead, null, Number(id)); }
        else if (next) location.hash = `lead/${m.lead_id}`;
      } catch (e) { fail(e); }
    };
    return [h("div", { class: "crumb" }, back(`#lead/${m.lead_id}`, m.name)),
      header(`${MEET_KIND[m.kind] || "Meeting"}: ${m.name}`, `${fmtWhen(m.scheduled_at)} · ${m.decision_maker_joining ? "decision-maker joining" : "decision-maker not confirmed"}${m.attendees ? ` · ${m.attendees}` : ""}`),
      m.notes && m.status === "booked" ? h("div", { class: "card" }, h("p", { class: "notes" }, m.notes)) : null,
      h("div", { class: "card" }, h("div", { class: "stack row" },
        h("button", { class: "btn ghost", type: "button", onclick: () => startWhatsApp(lead, { time: fmtTime(m.scheduled_at), day: fmtDay(m.scheduled_at) }) }, "WhatsApp reminder"),
        h("button", { class: "btn ghost", type: "button", onclick: () => downloadIcs(lead, m) }, "Calendar (.ics)"),
        h("button", { class: "btn ghost", type: "button", onclick: () => bookSheet(lead, m) }, "Reschedule"))),
      h("div", { class: "card" }, f.el),
      h("div", { class: "savebar" }, h("button", { class: "btn", type: "button", onclick: () => save(true) }, "Save meeting"))];
  }

  async function vPipeline() {
    const [dl, ms, st] = await Promise.all([api("deals"), api(`meetings?from=${gulfToday()}`), api(`stats?from=${settings?.start_date || "2026-11-02"}&to=${gulfToday()}`)]);
    const out = [header("Pipeline", "Meetings → EOI → booking → commission paid")];
    const s = st.status;
    const funnel = [["new", "Not called"], ["attempting", "Attempting"], ["conversation", "Spoke"], ["meeting_booked", "Meeting booked"], ["meeting_held", "Met"], ["qualified", "Qualified"], ["eoi", "EOI"], ["won", "Won"]];
    out.push(card("Leads by stage", null, h("div", { class: "stages" }, funnel.map(([k, l]) => h("a", { href: "#leads", class: "stg", onclick: () => { leadQuery = { view: "all", q: "" }; } },
      h("b", null, String(s[k] || 0)), h("small", null, l))))));
    const up = ms.meetings.filter((m) => m.status === "booked");
    out.push(card("Upcoming meetings", `${up.length}`, up.length ? up.map((m) => h("a", { class: "lrow link-row", href: `#meeting/${m.id}` },
      h("div", { class: "lmain" }, h("b", null, `${fmtWhen(m.scheduled_at)} · ${m.name}`), h("small", null, `${MEET_KIND[m.kind]}${m.decision_maker_joining ? " · decision-maker joining" : " · ⚠ decision-maker not confirmed"}`)))) : empty("No meetings booked. 3 qualified meetings a week is the number that matters.")));
    const live = dl.deals.filter((d) => d.stage !== "fell_through");
    const cols = STAGES.map(([k, l]) => {
      const ds = live.filter((d) => d.stage === k);
      const total = ds.reduce((t, d) => t + netOf(d), 0);
      return h("div", { class: "col" }, h("h3", null, l, h("small", null, `${ds.length}${ds.length ? ` · ${usd(total)}` : ""}`)),
        ds.map((d) => h("div", { class: "dcard" },
          h("button", { class: "dmain", type: "button", onclick: async () => { const ld = await api(`leads/${d.lead_id}`); dealSheet(ld.lead, d); } },
            h("b", null, d.name), h("small", null, [d.project, d.unit].filter(Boolean).join(" · ") || "—"),
            h("span", null, `${aed(d.price_aed)} · net ${both(netOf(d))}`),
            d.commission_expected_at && k !== "paid" ? h("small", null, `Commission expected ${fmtDay(d.commission_expected_at)}`) : null),
          k !== "paid" ? h("button", { class: "next", type: "button", onclick: () => advanceDeal(d) }, `→ ${STAGE[STAGES[STAGES.findIndex((x) => x[0] === k) + 1][0]]}`) : null)));
    });
    out.push(h("div", { class: "card" }, h("h2", null, "Deals", h("small", null, `${live.length} live`)),
      live.length ? h("div", { class: "board" }, cols) : empty("No deals yet. The close is the EOI or booking deposit."),
      dl.deals.some((d) => d.stage === "fell_through") ? h("details", null, h("summary", null, "Fell through"), dl.deals.filter((d) => d.stage === "fell_through").map((d) =>
        h("p", { class: "small" }, `${d.name} · ${d.project || ""} · ${d.fell_through_reason || "no reason noted"}`))) : null));
    return out;
  }

  let numRange = "week";
  async function vNumbers() {
    const today = gulfToday();
    const ranges = { week: ["This week", mondayOf(today), today], last: ["Last week", addDays(mondayOf(today), -7), addDays(mondayOf(today), -1)],
      month: ["This month", `${today.slice(0, 7)}-01`, today], all: ["Since start", settings?.start_date || "2026-11-02", today] };
    const [, from, to] = ranges[numRange];
    const st = await api(`stats?from=${from < to ? from : to}&to=${to}`);
    settings = st.settings;
    const s = st.settings, f = st.funnel, r = st.rates, g = st.goal;
    const out = [header("Numbers", `${fmtDay(fromGulf(from))} – ${fmtDay(fromGulf(to))}`)];
    out.push(h("div", { class: "seg wide rng" }, Object.entries(ranges).map(([k, [l]]) => h("button", { type: "button", "aria-pressed": String(k === numRange), onclick: () => { numRange = k; refresh(); } }, l))));

    // Goal
    const goalAed = s.goal_usd * AED_PER_USD;
    const daysLeft = Math.max(0, Math.round((Date.parse(`${s.deadline}T23:59:00+04:00`) - Date.now()) / 864e5));
    out.push(card(`$${(s.goal_usd / 1000).toFixed(0)}K goal`, `${daysLeft} days to ${fmtDay(fromGulf(s.deadline))}`,
      bar(g.closed_n, s.deals_target, `Deals closed (plan for ${s.deals_buffer})`),
      h("div", { class: "goalbars" },
        goalLine("Booked (closed deals, net)", g.booked_net_aed, goalAed),
        goalLine("Paid (cash in hand)", g.paid_net_aed, goalAed),
        goalLine("In EOI / allocation", g.pipeline_net_aed, goalAed)),
      h("p", { class: "fhint" }, `Net per deal assumed $${(s.net_per_deal_usd / 1000).toFixed(0)}K after Lyka's split. Developers usually pay 1–3 months after booking, so cash by April means closing by end of February.`)));

    // Funnel with leak
    const checks = [["pickup", "Pick-up", "conversations ÷ touches", f.touches, 30], ["book", "Booked", "meetings booked ÷ conversations", f.conversations, 20],
      ["show", "Show-up", "held ÷ meetings due", f.due, 3], ["close", "Close", "closed ÷ held", f.held, 3]];
    const scored = checks.filter(([k, , , n, min]) => r[k] != null && n >= min).map(([k]) => [k, r[k] / s.rates[k]]).sort((a, b) => a[1] - b[1]);
    const leak = scored.length && scored[0][1] < 1 ? scored[0][0] : null;
    out.push(card("Funnel", leak ? h("span", { class: "pill down" }, `Leak: ${checks.find((c) => c[0] === leak)[1]}`) : scored.length ? h("span", { class: "pill up" }, "On target") : "need more data",
      h("div", { class: "funnel" },
        frow("Touches (dials + WhatsApp)", f.touches), frow("Conversations", f.conversations, r.pickup, s.rates.pickup, leak === "pickup"),
        frow("Meetings booked", f.booked, r.book, s.rates.book, leak === "book"), frow("Meetings held", f.held, r.show, s.rates.show, leak === "show"),
        frow("Qualified (3 gates)", f.qualified, r.qualified), frow("EOIs", f.eoi), frow("Closed (booking)", f.closed, r.close, s.rates.close, leak === "close")),
      h("p", { class: "fhint" }, leak ? `Fix ${checks.find((c) => c[0] === leak)[1].toLowerCase()} (${checks.find((c) => c[0] === leak)[2]}) next week, not everything.`
        : "Rates show once there's enough data: 30 touches, 20 conversations, 3 meetings.")));

    if (numRange === "week" || numRange === "last") {
      out.push(card("Weekly targets", null, bar(f.touches, s.weekly.touches, "Touches"), bar(f.conversations, s.weekly.conversations, "Conversations"),
        bar(f.booked, s.weekly.booked, "Meetings booked"), bar(f.held, s.weekly.held, "Meetings held"), bar(f.eoi, s.weekly.eoi, "EOI attempts")));
    }

    out.push(card("Speed to lead", `${st.speed.n} inbound`,
      st.speed.n ? h("div", { class: "cmp" },
        h("div", null, h("small", null, "Median first call"), h("b", null, st.speed.median_min == null ? "—" : `${st.speed.median_min < 1 ? "<1" : Math.round(st.speed.median_min)} min`)),
        h("div", null, h("small", null, "Within 5 min"), h("b", null, st.speed.contacted ? pct(st.speed.within5 / st.speed.contacted) : "—")),
        h("div", null, h("small", null, "Not called yet"), h("b", null, String(st.speed.n - st.speed.contacted)))) : empty("No inbound leads in this period."),
      h("p", { class: "fhint" }, "Reply to every inbound lead within 5 minutes. This alone wins deals.")));

    out.push(card("Sales calls", `${st.held_n} held`,
      st.held_n ? h("div", null,
        h("div", { class: "cmp" },
          h("div", null, h("small", null, "Avg 1–10 score"), h("b", null, st.close_avg ? st.close_avg.toFixed(1) : "—")),
          h("div", null, h("small", null, "Need gate failed"), h("b", null, String(st.leaks.need))),
          h("div", null, h("small", null, "Decision gate failed"), h("b", null, String(st.leaks.decision)))),
        h("div", { class: "cmp" },
          h("div", null, h("small", null, "Budget gate failed"), h("b", null, String(st.leaks.budget))),
          h("div", null, h("small", null, "No decision-maker"), h("b", null, String(st.leaks.no_dm))),
          h("div", null, h("small", null, "Qualified rate"), h("b", null, pct(r.qualified)))),
        Object.keys(st.objections).length ? h("div", null, h("h3", { class: "t10-h" }, "Objections heard"),
          Object.entries(st.objections).sort((a, b) => b[1] - a[1]).map(([k, n]) => h("div", { class: "wrow" }, h("div", null, h("b", null, OBJ[k]?.q || k), h("small", null, OBJ[k]?.why || "")), h("div", { class: "r" }, h("div", null, String(n))))),
          h("p", { class: "fhint" }, "Most of these shouldn't appear if the gates were done properly. If one does, find which gate leaked.")) : null)
        : empty("No meetings held in this period.")));

    out.push(card("Weekly KPI tracker", null, h("div", { class: "tscroll" }, h("table", { class: "kpi" },
      h("thead", null, h("tr", null, ["Week of", "Touches", "Conv.", "Booked", "Held", "Qualified", "EOIs", "Closed", "Net"].map((x) => h("th", null, x)))),
      h("tbody", null, [...st.weeks].reverse().map((w) => h("tr", null, h("td", null, fmt(fromGulf(w.week), { day: "numeric", month: "short" })),
        h("td", { class: w.touches >= s.weekly.touches ? "hit" : "" }, w.touches), h("td", { class: w.conversations >= s.weekly.conversations ? "hit" : "" }, w.conversations),
        h("td", { class: w.booked >= s.weekly.booked ? "hit" : "" }, w.booked), h("td", { class: w.held >= s.weekly.held ? "hit" : "" }, w.held), h("td", null, w.qualified),
        h("td", { class: w.eoi >= s.weekly.eoi ? "hit" : "" }, w.eoi), h("td", null, w.closed), h("td", null, w.net_aed ? usd(w.net_aed) : "")))))),
      h("p", { class: "fhint" }, `Targets: ${s.weekly.touches} touches · ${s.weekly.conversations} conversations · ${s.weekly.booked} booked · ${s.weekly.held} held · ${s.weekly.eoi} EOI. Green = hit.`)));

    out.push(card("Monthly targets", null, s.monthly.map((m) => {
      const n = g.months[m.month] || 0;
      return h("div", { class: "wrow" }, h("div", null, h("b", null, fmt(fromGulf(`${m.month}-01`), { month: "short", year: "numeric" })), h("small", null, m.focus)),
        h("div", { class: "r" }, h("div", { class: n >= m.low && (n > 0 || m.low === 0) ? "up" : "" }, `${n} / ${m.low === m.high ? m.high : `${m.low}–${m.high}`}`)));
    })));

    out.push(card("Lead sources", "all time", st.sources.length ? h("div", { class: "tscroll" }, h("table", { class: "kpi" },
      h("thead", null, h("tr", null, ["Source", "Leads", "Reached", "Met", "Won"].map((x) => h("th", null, x)))),
      h("tbody", null, st.sources.map((x) => h("tr", null, h("td", null, SOURCE[x.source] || x.source || "—"), h("td", null, x.leads), h("td", null, x.reached), h("td", null, x.met), h("td", null, x.won))))))
      : empty("No leads yet."), h("p", { class: "fhint" }, "Put your hours where leads turn into meetings.")));
    out.push(h("div", { class: "card" }, h("a", { class: "btn", href: "#review" }, "Friday review →")));
    return out;
  }
  function goalLine(label, valAed, goalAed) {
    const p = goalAed ? Math.min(1, valAed / goalAed) : 0;
    return h("div", { class: "kbar" }, h("div", { class: "kl" }, h("span", null, label), h("b", null, usd(valAed), h("em", null, ` · ${aed(valAed)}`))),
      h("div", { class: "track" }, h("span", { class: p >= 1 ? "full" : "", style: `width:${(p * 100).toFixed(1)}%` })));
  }
  function frow(label, n, rate, target, isLeak) {
    return h("div", { class: `frow${isLeak ? " leak" : ""}` }, h("span", null, label), h("b", null, String(n ?? 0)),
      h("span", { class: "fr" }, rate == null ? "" : pct(rate), target != null ? h("small", null, ` / ${pct(target)}`) : null));
  }

  async function vReview() {
    const today = gulfToday();
    const wk = mondayOf(today);
    const [st, hot, nur] = await Promise.all([api(`stats?from=${wk}&to=${today}`), api("leads?temperature=hot&view=open&sort=next&limit=50"), api("leads?temperature=nurture&view=open&sort=next&limit=50")]);
    const s = st.settings, r = st.rates;
    const key = `crm-review-${wk}`;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { /* ignore */ }
    const tick = (k, label) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!done[k], onchange: (e) => { done[k] = e.target.checked; try { localStorage.setItem(key, JSON.stringify(done)); } catch (er) { /* ignore */ } } }), h("span", null, label));
    const checks = [["Pick-up", r.pickup, s.rates.pickup], ["Booked", r.book, s.rates.book], ["Show-up", r.show, s.rates.show], ["Close", r.close, s.rates.close]];
    const missed = checks.filter((c) => c[1] != null && c[1] < c[2]).sort((a, b) => a[1] / a[2] - b[1] / b[2]);
    return [h("div", { class: "crumb" }, back("#numbers", "Numbers")), header("Friday review", `Week of ${fmtDay(fromGulf(wk))} · 30 minutes`),
      card("1. Which conversion rate missed target?", null,
        checks.map(([l, v, t]) => h("div", { class: "wrow" }, h("div", null, h("b", null, l)), h("div", { class: "r" }, h("div", { class: v == null ? "" : v >= t ? "up" : "down" }, `${pct(v)} / ${pct(t)}`)))),
        h("p", { class: "fhint" }, missed.length ? `Fix ${missed[0][0].toLowerCase()} next week. Only that one.` : "Nothing below target (or not enough data yet)."), tick("q1", "Picked the one leak to fix")),
      card("2. Listen to 2 of your own recorded calls", null, h("p", { class: "fhint" }, "Score tonality (friendly open · calm discovery · confident price · pause) and whether you passed all three gates."),
        tick("q2a", "Call 1 reviewed"), tick("q2b", "Call 2 reviewed")),
      card("3. Update hot and nurture lists", `${hot.total} hot · ${nur.total} nurture`, h("p", { class: "fhint" }, "Hot = call this week. Nurture = monthly touch with something useful."),
        hot.leads.slice(0, 12).map((l) => leadRow(l)), h("details", null, h("summary", null, `Nurture list (${nur.total})`), nur.leads.map((l) => leadRow(l))), tick("q3", "Lists updated")),
      st.stalled.length ? card("Stalled deals", "no change in 14+ days", st.stalled.map((d) => h("div", { class: "wrow" }, h("div", null, h("b", null, d.name), h("small", null, `${d.project || ""} ${d.unit || ""}`)), h("div", { class: "r" }, h("div", null, STAGE[d.stage]))))) : null,
      card("4. Is my offer specific enough?", null, h("p", { class: "fhint" }, "Would a buyer pick me over 10 agents for this? “I help Indian professionals abroad buy the right off-plan property in Dubai through my Launch Filter, matched to their goal, on a payment plan they can actually fund.”"), tick("q4", "Offer checked"))];
  }

  async function vInventory() {
    const { inventory } = await api("inventory");
    const out = [h("div", { class: "crumb" }, back("#more", "More")), header("Launch Filter", "Every unit passes 3 filters before a client sees it",
      h("button", { class: "icon-btn", type: "button", "aria-label": "Add a project", onclick: () => invSheet() }, "+"))];
    out.push(h("div", { class: "card" }, h("p", { class: "fhint" }, "Max 3 areas and 1–2 developers per area. Start with 2 lanes in November; add the third once you can pitch both without notes.")));
    for (const [lane, label] of [...opts(LANE), [null, "No lane"]]) {
      const items = inventory.filter((i) => (i.lane || null) === lane);
      if (!items.length) continue;
      out.push(card(label, `${items.length}`, items.map((i) => {
        const pass = i.f_delivery && i.f_growth && i.f_payment;
        return h("button", { class: "lrow link-row", type: "button", onclick: () => invSheet(i) }, h("div", { class: "lmain" },
          h("b", null, i.project, h("span", { class: `st ${pass ? "s-won" : "s-lost"}` }, pass ? "Passes" : "Fails filter"), i.status !== "active" ? h("span", { class: "tag" }, i.status === "sold_out" ? "Sold out" : "Archived") : null),
          h("small", null, [i.developer, i.area, i.price_from_aed ? `from ${aed(i.price_from_aed)}` : null, i.down_payment_pct ? `${i.down_payment_pct}% down` : null,
            i.commission_pct != null ? `${i.commission_pct}% commission` : null, i.handover ? `handover ${i.handover}` : null].filter(Boolean).join(" · ")),
          h("small", null, `${i.f_delivery ? "✓" : "✗"} delivery record  ${i.f_growth ? "✓" : "✗"} growth driver  ${i.f_payment ? "✓" : "✗"} payment-plan fit${i.eoi_deadline ? ` · EOI by ${fmtDay(fromGulf(i.eoi_deadline))}` : ""}`)));
      })));
    }
    if (!inventory.length) out.push(card("No projects yet", null, empty("Pick your lanes and 1–2 developers per lane, then add the launches that pass.", h("button", { class: "btn", type: "button", onclick: () => invSheet() }, "Add a project"))));
    return out;
  }
  function invSheet(i = null) {
    const f = form([
      { k: "project", label: "Project", required: true }, { k: "developer", label: "Developer", half: true }, { k: "area", label: "Area", half: true },
      { k: "lane", label: "Lane", type: "chips", options: opts(LANE) },
      { k: "unit_types", label: "Unit types", placeholder: "3–5BR villas, townhouses" },
      { k: "price_from_aed", label: "From (AED)", type: "money", half: true }, { k: "down_payment_pct", label: "Down payment %", type: "number", half: true },
      { k: "commission_pct", label: "Agency commission %", type: "number", half: true, step: "0.1", hint: "Blank = the developer's rate from Settings" },
      { k: "payment_plan", label: "Payment plan", placeholder: "10/50/40, 1% monthly" }, { k: "handover", label: "Handover", half: true, placeholder: "Q4 2028" },
      { k: "eoi_deadline", label: "EOI deadline", type: "date", half: true },
      { type: "heading", label: "The Launch Filter" },
      { k: "f_delivery", label: "1. Developer delivery record", type: "pass" },
      { k: "f_growth", label: "2. Location growth driver", type: "pass", hint: "e.g. Al Maktoum airport expansion, D33, 2040 plan" },
      { k: "f_payment", label: "3. Payment-plan fit (fundable from salary)", type: "pass" },
      { k: "filter_notes", label: "Why it passed / failed", type: "textarea" },
      { k: "link", label: "Link", type: "url" },
      { k: "status", label: "Status", type: "chips", options: [["active", "Active"], ["sold_out", "Sold out"], ["archived", "Archived"]], required: true },
    ], i || { status: "active" });
    const close = sheet(i ? i.project : "Add a project", f.el, [
      h("button", { class: "btn", type: "button", onclick: async () => { const b = f.get(); if (!b.project) return toast("Project is required");
        try { i ? await api(`inventory/${i.id}`, { method: "PATCH", body: b }) : await api("inventory", { method: "POST", body: b }); close(); refresh(); } catch (e) { fail(e); } } }, "Save"),
      i ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!confirm("Delete this project?")) return; await api(`inventory/${i.id}`, { method: "DELETE" }); close(); refresh(); } }, "Delete") : null]);
  }

  function vScripts() {
    const say = (t) => h("button", { class: "say", type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.currentTarget.classList.add("copied"); } catch (er) { /* no clipboard */ } } },
      h("span", { class: "t" }, t), h("span", { class: "copy" }, "Copy"));
    const blk = (title, sub, lines) => card(title, sub, lines.map((x) => (typeof x === "string" ? say(x) : x)));
    return [h("div", { class: "crumb" }, back("#more", "More")), header("Scripts", "Say them out loud until they take under 10 seconds"),
      blk("Value proposition", "X through Y to get Z", ["I help Indian professionals abroad buy the right off-plan property in Dubai through my Launch Filter, matched to their goal, on a payment plan they can actually fund."]),
      blk("Cold call", "a ladder: each step buys 10 seconds", [
        h("p", { class: "fhint" }, "Goal: a booked meeting, permission to stay in touch, or a referral. Hang up only after three nos."),
        "Ravi! How are you doing?", "It's Sanjay from Lyka Realty. Is this a good time?",
        "I help Indian professionals buy off-plan in Dubai: waterfront, growth areas or the best-value launches, on payment plans they can fund from salary. Is owning in Dubai something you've been thinking about?",
        "Totally understand. Before I let you go: are you not looking at all, or just not right now?",
        "No problem. Can I WhatsApp you when a launch fits what you described? I only send the ones that pass my filter.",
        "Who in your circle has been talking about buying in Dubai?"]),
      blk("BANT", "“I don't want to waste your time with options that don't fit. Can I ask four quick questions?”", [
        "Is this for investment, to live in, or for residency for the family?", "What range are you comfortable with, and would it be cash or with a mortgage?",
        "Who else is part of this decision: your wife, parents, a business partner?", "When are you looking to move: this launch, or in the next 6 months?"]),
      blk("Book the meeting", "two slots, never “when are you free?”", ["Here's what I'll do: I'll shortlist 3 villas that fit what you told me and walk you through them on a 30-minute video call. I have Thursday at 11 or Saturday at 2. Which is better? And can your wife join?"]),
      blk("Sales call: context", null, ["Before I show you anything, I need to understand what you're actually trying to achieve, otherwise I'm just sending you brochures like every other agent. If what we have fits, I'll show you 3 options. If it doesn't, I'll tell you honestly. Fair?"]),
      blk("The 3 Gates", "align, educate or disqualify at every gate", [
        "Why Dubai, and why now?", "Why that area or property type?", "What does this property need to do for your family in 5 years?",
        "Have you looked at other launches? What stopped you?", "Who else needs to be comfortable with this?", "When would you want to lock in a unit?",
        "What range are you comfortable investing, including the down payment?", "Villas in this area run from roughly [low] to [high]. Where do you sit?",
        "Is it that the funds aren't there, or that you'd rather not put that much into one property?",
        "If I show you a unit that fits everything you've told me, at around [X] with [Y]% upfront, would you be ready to move on it?"]),
      blk("Belief-break + pitch", null, ["How much do you think you need upfront to own an AED 2M villa?", "Do you think the best units in a hot launch go to whoever calls first on launch day?",
        "Every unit I show passes my Launch Filter: developer delivery record, location growth driver, payment-plan fit.",
        "EOI, allocation, booking, SPA, Oqood registration, construction updates, handover, leasing. You do the decisions; I handle the rest."]),
      blk("The close", "then stop talking", ["On a scale of 1 to 10, 1 not for you, 10 lock it in today: where are you?", "Why not lower?", "What would make it a 10?",
        "Let's secure the EOI now. It holds your place in the allocation.", "Earlier you said you were ready to decide now. What changed?"]),
      card("Objections", "agree → ask why → isolate → realign or educate", h("p", { class: "fhint" }, "“If we solve this, are you ready today?”"),
        OBJECTIONS.map((o) => h("details", { class: "obj" }, h("summary", null, `“${o.q}”`), h("p", { class: "small muted" }, o.why), say(o.move)))),
      card("Compliance", "material risk", h("ul", { class: "brief" }, ["UAE numbers: call only 9 AM–6 PM.", "Never call numbers on the Do Not Call Registry (DNCR).",
        "If they say no, don't call back the same day; no excessive follow-ups.", "No pressure or misleading claims. Never promise returns or guaranteed appreciation (RERA).",
        "Ask Lyka which number and process to use for marketing calls, and whether calls must be recorded and logged."].map((x) => h("li", null, x))))];
  }

  function parseCsv(text) {
    const first = text.split(/\r?\n/)[0] || "";
    const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  const FIELD_GUESS = [["name", /^(full ?name|name|contact( name)?|client)$/i], ["first", /^first ?name$/i], ["last", /^(last ?name|surname)$/i],
    ["phone", /(phone|mobile|cell|number|contact no|tel)/i], ["whatsapp", /whats ?app/i], ["email", /e-?mail/i], ["city", /^city|location$/i], ["country", /^country$/i],
    ["company", /(company|organi[sz]ation|employer)/i], ["job_title", /(title|position|designation|role)/i], ["notes", /(note|comment|remark|message)/i], ["source_detail", /(source|campaign|list)/i], ["tags", /^tags?$/i]];
  function vImport() {
    const res = h("div");
    const defs = form([
      { k: "source", label: "Source for these leads", type: "chips", options: opts(SOURCE), required: true },
      { k: "country", label: "Default country (numbers without +code)", type: "chips", options: [["AE", "UAE"], ["IN", "India"], ["US", "USA"]] },
      { k: "icp", label: "Buyer type", type: "chips", options: opts(ICP) },
    ], { source: "lyka", icp: "nri" });
    const area = h("textarea", { rows: 6, placeholder: "Paste CSV here (first row = column names), or pick a file below." });
    const file = h("input", { type: "file", accept: ".csv,text/csv,.txt" });
    file.addEventListener("change", async () => { if (file.files[0]) { area.value = await file.files[0].text(); preview(); } });
    let parsed = null, mapping = [];
    const prevEl = h("div");
    const preview = () => {
      const rows = parseCsv(area.value);
      if (rows.length < 2) { prevEl.replaceChildren(h("p", { class: "fhint" }, "Need a header row plus at least one lead.")); parsed = null; return; }
      const [head, ...body] = rows;
      parsed = body;
      mapping = head.map((col) => { const g = FIELD_GUESS.find(([, re]) => re.test(col.trim())); return g ? g[0] : ""; });
      const sels = head.map((col, i) => { const s = h("select", { class: "mini", onchange: (e) => { mapping[i] = e.target.value; } },
        h("option", { value: "" }, "Skip"), [["name", "Name"], ["first", "First name"], ["last", "Last name"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["email", "Email"],
          ["city", "City"], ["country", "Country"], ["company", "Company"], ["job_title", "Job title"], ["notes", "Notes"], ["source_detail", "Source detail"], ["tags", "Tags"]].map(([v, l]) => h("option", { value: v }, l)));
        s.value = mapping[i]; return h("div", { class: "maprow" }, h("span", null, col || `Column ${i + 1}`), h("small", null, body[0]?.[i] || ""), s); });
      prevEl.replaceChildren(h("h3", { class: "fh" }, `${body.length} rows · match the columns`), ...sels);
    };
    area.addEventListener("input", () => { clearTimeout(area._t); area._t = setTimeout(preview, 300); });
    const go = h("button", { class: "btn", type: "button", onclick: async () => {
      if (!parsed) return toast("Nothing to import");
      const d = defs.get();
      const rows = parsed.map((r) => {
        const o = {};
        mapping.forEach((m, i) => { if (m && r[i] != null && r[i].trim()) o[m] = (o[m] ? `${o[m]} ` : "") + r[i].trim(); });
        if (!o.name && (o.first || o.last)) o.name = [o.first, o.last].filter(Boolean).join(" ");
        delete o.first; delete o.last;
        if (o.country) { const c = o.country.toLowerCase(); o.country = /emirates|uae|dubai/.test(c) ? "AE" : /india/.test(c) ? "IN" : /united states|usa|^us$/.test(c) ? "US" : /kingdom|uk|england/.test(c) ? "UK" : null; }
        return o;
      });
      go.disabled = true;
      try {
        const r = await api("import", { method: "POST", body: { rows, source: d.source, country: d.country, icp: d.icp } });
        res.replaceChildren(h("p", { class: "warnbox soft ok" }, `Added ${r.added} · skipped ${r.skipped} already in the CRM · ${r.invalid} empty rows`),
          h("a", { class: "btn", href: "#today" }, "Go to today's list"));
        area.value = ""; parsed = null; prevEl.replaceChildren();
      } catch (e) { fail(e); } finally { go.disabled = false; }
    } }, "Import leads");
    return [h("div", { class: "crumb" }, back("#more", "More")), header("Import", "Lyka CRM export, Apollo, LinkedIn, your contacts"),
      h("div", { class: "card" }, defs.el, h("div", { class: "fld" }, h("label", null, "CSV"), area, file), prevEl, h("div", { class: "stack" }, go), res),
      h("div", { class: "card" }, h("p", { class: "fhint" }, "Duplicates are skipped by phone number. UAE numbers like 050… become +97150…; Indian 10-digit mobiles become +91…. Purchased owner databases: check with Lyka the data is legally sourced first."))];
  }

  async function vSettings() {
    const r = await api("settings");
    const s = r.settings;
    const f = form([
      { type: "heading", label: "Goal" },
      { k: "goal_usd", label: "Goal ($ net)", type: "money", half: true }, { k: "net_per_deal_usd", label: "Net per deal ($)", type: "money", half: true },
      { k: "deals_target", label: "Deals needed", type: "number", half: true }, { k: "deals_buffer", label: "Deals planned (buffer)", type: "number", half: true },
      { k: "start_date", label: "Start date", type: "date", half: true }, { k: "deadline", label: "Deadline", type: "date", half: true },
      { type: "heading", label: "Commission defaults for new deals" },
      { k: "split_pct", label: "Lyka split: yours %", type: "number", half: true },
      { k: "commission_pct", label: "Commission if developer not listed %", type: "number", half: true, step: "0.1" },
      { type: "heading", label: "Activity targets" },
      { k: "daily_touches", label: "Touches per day", type: "number", half: true },
      { k: "w_touches", label: "Weekly touches", type: "number", half: true }, { k: "w_conversations", label: "Weekly conversations", type: "number", half: true },
      { k: "w_booked", label: "Weekly booked", type: "number", half: true }, { k: "w_held", label: "Weekly held", type: "number", half: true }, { k: "w_eoi", label: "Weekly EOIs", type: "number", half: true },
      { type: "heading", label: "Assumed rates (recalibrate after 200 dials)" },
      { k: "r_pickup", label: "Pick-up %", type: "number", half: true, step: "0.1" }, { k: "r_book", label: "Booked % of conversations", type: "number", half: true, step: "0.1" },
      { k: "r_show", label: "Show-up %", type: "number", half: true, step: "0.1" }, { k: "r_close", label: "Close % of held", type: "number", half: true, step: "0.1" },
    ], { ...s, w_touches: s.weekly.touches, w_conversations: s.weekly.conversations, w_booked: s.weekly.booked, w_held: s.weekly.held, w_eoi: s.weekly.eoi,
      r_pickup: +(s.rates.pickup * 100).toFixed(1), r_book: +(s.rates.book * 100).toFixed(1), r_show: +(s.rates.show * 100).toFixed(1), r_close: +(s.rates.close * 100).toFixed(1) });
    const monthEls = s.monthly.map((m) => ({ m, low: h("input", { type: "number", value: m.low, class: "tiny", "aria-label": `${m.month} low` }), high: h("input", { type: "number", value: m.high, class: "tiny", "aria-label": `${m.month} high` }),
      focus: h("input", { type: "text", value: m.focus, "aria-label": `${m.month} focus` }) }));
    const devRow = (x = {}) => ({ dev: h("input", { type: "text", value: x.developer || "", placeholder: "Developer", "aria-label": "Developer" }),
      pct: h("input", { type: "number", value: x.pct ?? "", step: "0.1", class: "tiny", placeholder: "%", "aria-label": "Commission %", inputmode: "decimal" }) });
    const devEls = (s.developer_commissions || []).map(devRow);
    const devWrap = h("div", null, devEls.map((r) => h("div", { class: "devrow" }, r.dev, r.pct, h("span", null, "%"))));
    const tplEls = s.templates.map((t) => ({ name: h("input", { type: "text", value: t.name }), text: h("textarea", { rows: 3, value: t.text }) }));
    const tplWrap = h("div", null, tplEls.map((t) => h("div", { class: "tplrow" }, t.name, t.text)));
    const save = async () => {
      const v = f.get();
      const body = {
        goal_usd: v.goal_usd, net_per_deal_usd: v.net_per_deal_usd, deals_target: v.deals_target, deals_buffer: v.deals_buffer, start_date: v.start_date, deadline: v.deadline,
        commission_pct: v.commission_pct, split_pct: v.split_pct, daily_touches: v.daily_touches,
        weekly: { touches: v.w_touches, conversations: v.w_conversations, booked: v.w_booked, held: v.w_held, eoi: v.w_eoi },
        rates: { pickup: v.r_pickup / 100, book: v.r_book / 100, show: v.r_show / 100, close: v.r_close / 100 },
        monthly: monthEls.map(({ m, low, high, focus }) => ({ month: m.month, focus: focus.value, low: Number(low.value) || 0, high: Number(high.value) || 0 })),
        developer_commissions: devEls.map((r) => ({ developer: r.dev.value.trim(), pct: Number(r.pct.value) })).filter((r) => r.developer && r.pct > 0),
        templates: tplEls.map((t) => ({ name: t.name.value.trim(), text: t.text.value.trim() })).filter((t) => t.name && t.text),
      };
      try { await api("settings", { method: "PUT", body }); await loadSettings(); toast("Settings saved"); } catch (e) { fail(e); }
    };
    return [h("div", { class: "crumb" }, back("#more", "More")), header("Settings"),
      h("div", { class: "card" }, f.el),
      card("Monthly deal targets", null, monthEls.map(({ m, low, high, focus }) => h("div", { class: "mrow" }, h("b", null, m.month), low, h("span", null, "–"), high, focus))),
      card("Commission by developer", "agency %, before Lyka's split", devWrap,
        h("p", { class: "fhint" }, "New deals and projects pick this up from the developer's name. Change a single deal on the deal itself."),
        h("button", { class: "btn ghost", type: "button", onclick: () => { const r = devRow(); devEls.push(r); devWrap.append(h("div", { class: "devrow" }, r.dev, r.pct, h("span", null, "%"))); r.dev.focus(); } }, "Add developer")),
      card("WhatsApp templates", "{first} = first name, {time} = meeting time", tplWrap,
        h("button", { class: "btn ghost", type: "button", onclick: () => { const t = { name: h("input", { type: "text", placeholder: "Name" }), text: h("textarea", { rows: 3 }) }; tplEls.push(t); tplWrap.append(h("div", { class: "tplrow" }, t.name, t.text)); } }, "Add template")),
      h("div", { class: "savebar" }, h("button", { class: "btn", type: "button", onclick: save }, "Save settings")),
      card("Inbound leads → 5-minute alert", r.has_telegram ? h("span", { class: "pill up" }, "Telegram on") : h("span", { class: "pill flat" }, "Telegram off"),
        h("p", { class: "fhint" }, "Point website forms, Meta lead ads (via Zapier/Make) or Lyka's lead emails at this address. Each POST (JSON or form: name, phone, email, project, message) adds a hot lead and pings Telegram."),
        r.inbound_url ? say2(r.inbound_url) : h("p", { class: "muted" }, "Needs DASHBOARD_PASSWORD on the server."),
        r.has_telegram ? h("button", { class: "btn ghost", type: "button", onclick: async () => { const x = await api("test-telegram", { method: "POST" }); toast(x.sent ? "Sent: check Telegram" : "Telegram didn't accept it"); } }, "Send a test alert")
          : h("p", { class: "fhint" }, "Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to GitHub Secrets (SETUP-KIT step 5) to switch alerts on.")),
      card("Backup", null, h("p", { class: "fhint" }, "Your data lives in Cloudflare D1 (point-in-time restore for 7 days on the free plan). Download a copy every Friday."),
        h("div", { class: "stack row" }, h("a", { class: "btn ghost", href: "/api/crm/export?table=all" }, "Full backup (JSON)"),
          ["leads", "touches", "meetings", "deals", "inventory"].map((t) => h("a", { class: "btn ghost", href: `/api/crm/export?table=${t}` }, `${t[0].toUpperCase()}${t.slice(1)} CSV`))))];
  }
  const say2 = (t) => h("button", { class: "say", type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.currentTarget.classList.add("copied"); toast("Copied"); } catch (er) { /* ignore */ } } },
    h("span", { class: "t mono" }, t), h("span", { class: "copy" }, "Copy"));

  function vMore() {
    const item = (href, title, sub) => h("a", { class: "lrow link-row", href }, h("div", { class: "lmain" }, h("b", null, title), h("small", null, sub)));
    return [header("More"),
      h("div", { class: "card list" },
        item("#review", "Friday review", "The 30-minute weekly check: leak, calls, lists, offer"),
        item("#inventory", "Launch Filter", "Projects per lane, checked against your 3 filters"),
        item("#scripts", "Scripts & objections", "Cold call, BANT, the 3 Gates, the close"),
        item("#import", "Import leads", "CSV from Lyka, Apollo, LinkedIn, contacts"),
        item("#settings", "Settings & backup", "Targets, commission, templates, inbound alerts, export"),
        item("/", "Morning Brief", "Back to the market dashboard"),
        h("a", { class: "lrow link-row", href: "/__logout" }, h("div", { class: "lmain" }, h("b", null, "Sign out"), h("small", null, "On this device")))),
      h("div", { class: "card" }, h("button", { class: "btn ghost", type: "button", onclick: () => {
        const light = document.documentElement.dataset.theme !== "light";
        if (light) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
        try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) { /* ignore */ }
      } }, "Switch light / dark"))];
  }

  // ---------- router ----------
  const ROUTES = { today: vToday, leads: vLeads, lead: vLead, meeting: vMeeting, pipeline: vPipeline, numbers: vNumbers, review: vReview,
    more: vMore, inventory: vInventory, scripts: vScripts, import: vImport, settings: vSettings };
  const NAV = { lead: "leads", meeting: "pipeline", review: "numbers", inventory: "more", scripts: "more", import: "more", settings: "more" };
  let renderSeq = 0;
  async function render() {
    const [name, arg] = (location.hash.slice(1) || "today").split("/");
    const fn = ROUTES[name] || vToday;
    const tab = NAV[name] || (ROUTES[name] ? name : "today");
    document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    const seq = ++renderSeq;
    const y = refreshing ? scrollY : 0;
    try {
      if (!settings) await loadSettings();
      const out = await fn(arg);
      if (seq !== renderSeq) return;
      view.replaceChildren(...[].concat(out).filter(Boolean));
      scrollTo(0, y);
    } catch (e) {
      if (seq !== renderSeq) return;
      view.replaceChildren(header("CRM"), h("div", { class: "card" }, h("p", { class: "warnbox" }, e.message || "Couldn't load."),
        e.status === 503 ? h("p", { class: "fhint" }, "The database binding is set up by the deploy workflow. See README → CRM.") : null,
        h("button", { class: "btn ghost", type: "button", onclick: render }, "Try again")));
    }
  }
  let refreshing = false;
  function refresh() { refreshing = true; render().finally(() => { refreshing = false; }); }
  addEventListener("hashchange", () => render());
  document.getElementById("fab").addEventListener("click", () => leadSheet());
  // Live timers on inbound leads (red after 5 minutes).
  setInterval(() => document.querySelectorAll(".timer[data-since]").forEach(paintTimer), 10000);
  // Coming back to the app after a while: refresh Today so the list is current.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 120000 && !sheetStack.length) refresh();
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  render();
})();
