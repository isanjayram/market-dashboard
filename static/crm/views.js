// Sanjay Ram CRM · main screens: Today, Leads (list + lead side by side on a laptop), Lead, Meeting,
// Tasks, Pipeline, Calendar, Payments.
(() => {
  "use strict";
  const C = window.CRM;
  const { h } = C;
  const iconBtn = (icon, label, onclick, extra = {}) => h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onclick, ...extra }, C.icon(icon, 19));
  const syncBadge = () => h("span", { class: "syncbadge", hidden: !C.queued(), "data-top": "no" }, C.icon("sync", 14), h("span", null, `${C.queued()} to sync`));

  function scheduleNow() {
    const hr = C.gulfHour();
    const blocks = [[8, 9, "Prep: today's list, launch updates, one piece of content"], [9, 11.5, "Calling block 1: 30 dials, phone only"],
      [11.5, 13, "Meetings, site visits, filming"], [13, 14, "Follow-ups: WhatsApp, emails, CRM"], [14, 16.5, "Calling block 2: 30 dials"],
      [16.5, 18, "Meetings + inbound (still legal calling hours)"], [18, 23, "Post content · WhatsApp NRIs (US mornings) · 30 min practice"]];
    const b = blocks.find(([a, z]) => hr >= a && hr < z);
    return b ? b[2] : "Off hours. Any inbound lead still gets a call within 5 minutes.";
  }
  function ring(p) {
    p = Math.max(0, Math.min(1, p || 0));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 44 44"); svg.setAttribute("class", "ring"); svg.setAttribute("aria-hidden", "true");
    const c = (cls, dash) => { const e = document.createElementNS(ns, "circle"); e.setAttribute("cx", "22"); e.setAttribute("cy", "22"); e.setAttribute("r", "18"); e.setAttribute("class", cls);
      if (dash != null) e.setAttribute("stroke-dasharray", `${dash} 200`); return e; };
    svg.append(c("rt"));
    if (p > 0) svg.append(c(p >= 1 ? "rf full" : "rf", Math.max(3, 2 * Math.PI * 18 * p).toFixed(1)));
    return svg;
  }

  // ---------- Today ----------
  C.route("today", async () => {
    const [t, brief] = await Promise.all([C.get("today"), C.get("/market/brief.json").catch(() => null)]);
    C.settings = t.settings;
    const s = t.settings;
    const touches = t.counts.touches || 0;
    const calling = (() => { const hr = C.gulfHour(); const [a, z] = s.calling_hours; return hr >= a && hr < z; })();
    const hero = h("section", { class: "card hero" },
      h("div", { class: "hero-row" },
        h("div", null, h("small", { class: "eyebrow" }, "Touches today"), h("div", { class: "hero-n" }, String(touches), h("em", null, `/ ${s.daily_touches}`))),
        h("div", { class: "ring-wrap" }, ring(touches / s.daily_touches))),
      h("div", { class: "hero-sub" }, h("span", { class: `pill ${calling ? "up" : "flat"}` }, calling ? "UAE calling hours open" : "UAE calling hours closed"),
        h("span", { class: "muted small" }, `${t.counts.conversations || 0} conversations`)),
      h("p", { class: "block-now" }, scheduleNow()));
    const inbound = t.inbound.length ? C.card(h("span", { class: "hot-t" }, "🔥 Inbound: call within 5 minutes"), `${t.inbound.length}`, t.inbound.map((l) => C.leadRow(l, "inbound"))) : null;
    const meetings = t.meetings.length ? C.card("Meetings today", `${t.meetings.length}`, t.meetings.map((m) => h("div", { class: "lrow" },
      h("a", { href: `#meeting/${m.id}`, class: "lmain" }, h("b", null, h("span", { class: "time" }, C.fmtTime(m.scheduled_at)), h("span", { class: "nm" }, m.name), m.status === "held" ? h("span", { class: "st s-meeting_held" }, "Held") : null),
        h("small", null, `${C.MEET_KIND[m.kind] || m.kind}${m.decision_maker_joining ? " · decision-maker joining" : " · ⚠ decision-maker not confirmed"}`)),
      h("div", { class: "acts" }, h("button", { class: "ab wa", type: "button", "aria-label": "Send reminder", onclick: () => C.startWhatsApp({ ...m, id: m.lead_id, status: "" }, { time: C.fmtTime(m.scheduled_at), day: C.fmtDay(m.scheduled_at) }) }, C.icon("wa", 18)))))) : null;
    const tasks = t.tasks.length ? C.card("Your tasks", h("a", { class: "more-link", href: "#tasks" }, "All tasks →"), t.tasks.map((x) => C.taskRow(x))) : null;
    const overdue = t.overdue.length ? C.card("Overdue follow-ups", `${t.overdue.length}`, t.overdue.map((l) => C.leadRow(l))) : null;
    const due = t.due.length ? C.card("Due today", `${t.due.length}`, t.due.map((l) => C.leadRow(l))) : null;
    const hot = t.hot.length ? C.card("Hot: no touch this week", `${t.hot.length}`, t.hot.map((l) => C.leadRow(l))) : null;
    const fresh = t.fresh.length ? C.card("Next up: fresh numbers", `${t.fresh.length}${t.fresh.length >= 40 ? "+" : ""}`, t.fresh.map((l) => C.leadRow(l, "fresh"))) : null;
    const nothing = !inbound && !overdue && !due && !hot && !fresh ? C.card("Your call list is empty", null, C.empty("Pull 300 numbers: warm network, Lyka CRM, engaged content audience.",
      h("div", { class: "stack row" }, h("a", { class: "btn", href: "#import" }, "Import a CSV"), h("button", { class: "btn ghost", type: "button", onclick: () => C.leadSheet() }, "Add a lead")))) : null;
    const payments = t.payments.length ? C.card("Client payments due", "next 7 days", t.payments.map((p) => payRow(p))) : null;
    const briefCard = brief && (brief.bullets?.length || brief.talking_points?.length) ? C.card("Morning brief", h("a", { class: "more-link", href: "#market/brief" }, "Market →"),
      brief.stale ? h("p", { class: "warnbox soft" }, `Stale: ${brief.stale_short || "old data"}`) : null,
      h("ul", { class: "brief" }, (brief.bullets || []).slice(0, 3).map((b) => h("li", null, b))),
      (brief.talking_points || []).length ? h("div", null, h("small", { class: "glabel" }, "Say this on calls · tap to copy"),
        brief.talking_points.slice(0, 3).map((p) => h("button", { class: "say", type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(p); e.currentTarget.classList.add("copied"); C.toast("Copied"); } catch (er) { /* ignore */ } } },
          h("span", { class: "t" }, p), h("span", { class: "copy" }, "Copy")))) : null) : null;
    const w = t.week;
    const week = C.card("This week", h("a", { class: "more-link", href: "#numbers" }, "Numbers →"),
      C.bar(w.touches || 0, s.weekly.touches, "Touches"), C.bar(w.conversations || 0, s.weekly.conversations, "Conversations"),
      C.bar(w.booked || 0, s.weekly.booked, "Meetings booked"), C.bar(w.held || 0, s.weekly.held, "Meetings held"), C.bar(w.eoi || 0, s.weekly.eoi, "EOI attempts"));
    const body = C.isDesktop()
      ? [h("div", { class: "cols" }, h("div", { class: "col-main" }, inbound, overdue, due, hot, fresh, nothing), h("div", { class: "col-side" }, hero, meetings, tasks, payments, briefCard, week))]
      : [hero, inbound, meetings, tasks, overdue, due, hot, fresh, nothing, payments, briefCard, week];
    return { title: "Today", sub: `${C.fmtDay(new Date().toISOString())} · ${C.fmtTime(new Date().toISOString())} Gulf`, wide: true,
      actions: [syncBadge(), iconBtn("tasks", "New task", () => C.taskSheet())], body };
  }, { prefetch: () => ["today", "/market/brief.json"] });
  function payRow(p) {
    const late = p.due_date < C.gulfToday();
    return h("div", { class: "lrow" },
      h("a", { class: "lmain", href: `#lead/${p.lead_id}` }, h("b", null, h("span", { class: "nm" }, p.name), h("span", { class: `st ${late ? "s-lost" : "s-eoi"}` }, late ? "Overdue" : C.dayLabel(p.due_date))),
        h("small", null, `${p.label || "Payment"} · ${C.aed(p.amount_aed)} · ${p.project || ""}${p.unit ? ` ${p.unit}` : ""}`)),
      h("div", { class: "acts" },
        h("button", { class: "ab wa", type: "button", "aria-label": "Remind the client", onclick: () => C.startWhatsApp({ id: p.lead_id, name: p.name, phone: p.phone, whatsapp: p.whatsapp },
          { amount: C.aed(p.amount_aed), date: C.fmtDay(p.due_date), preset: { name: "Payment reminder", text: "Hi {first}, a friendly reminder that the {amount} payment for your unit is due on {date}. Let me know if you need the developer's payment details." } }) }, C.icon("wa", 18)),
        h("button", { class: "ab", type: "button", "aria-label": "Mark paid", onclick: async () => { await C.api(`installments/${p.id}`, { method: "PATCH", body: { paid: true }, queue: true }); C.toast("Marked paid"); C.refresh(); } }, C.icon("check", 18))));
  }
  C.payRow = payRow;

  // ---------- Leads (list pane) ----------
  const FILTER_CHIPS = [["open", "Open"], ["hot", "Hot"], ["nurture", "Nurture"], ["new", "Not called"], ["pipeline", "In pipeline"], ["won", "Won"], ["lost", "Lost"], ["all", "All"]];
  const pane = { view: "open", q: "", sort: "", extra: {}, smart: null, selecting: false, picked: new Set(), offset: 0, el: null, selectedId: null };
  function params(offset = 0) {
    const p = new URLSearchParams();
    if (pane.smart) new URLSearchParams(pane.smart.query).forEach((v, k) => p.set(k, v));
    else {
      const f = pane.view;
      if (f === "open" || f === "pipeline") p.set("view", f);
      if (f === "hot" || f === "nurture") { p.set("temperature", f); p.set("view", "open"); }
      if (f === "new") p.set("status", "new");
      if (f === "won") p.set("status", "won");
      if (f === "lost") p.set("status", "lost");
    }
    for (const [k, v] of Object.entries(pane.extra)) if (v != null && v !== "") p.set(k, v);
    if (pane.q) p.set("q", pane.q);
    if (pane.sort) p.set("sort", pane.sort);
    p.set("limit", "100"); p.set("offset", String(offset));
    return p.toString();
  }
  function buildPane() {
    const list = h("div", { class: "lp-list" });
    const count = h("small", { class: "muted lp-count" });
    const search = h("input", { type: "search", placeholder: "Search name, phone, company, notes", value: pane.q, autocomplete: "off", "aria-label": "Search leads" });
    let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { pane.q = search.value.trim(); load(); }, 250); });
    const chips = h("div", { class: "chips scroll" });
    const paintChips = () => chips.replaceChildren(
      ...FILTER_CHIPS.map(([v, l]) => h("button", { type: "button", "aria-pressed": String(!pane.smart && pane.view === v), onclick: () => { pane.smart = null; pane.view = v; paintChips(); load(); } }, l)),
      ...(C.settings?.smart_lists || []).map((sl) => h("button", { type: "button", class: "smart", "aria-pressed": String(pane.smart?.name === sl.name), onclick: () => { pane.smart = pane.smart?.name === sl.name ? null : sl; paintChips(); load(); } }, "★ ", sl.name)));
    const filterBtn = h("button", { class: "btn ghost sm", type: "button", onclick: () => filterSheet() }, C.icon("filter", 16), "Filter");
    const sort = h("select", { class: "mini", "aria-label": "Sort", onchange: (e) => { pane.sort = e.target.value; load(); } },
      [["", "Recent activity"], ["next", "Next follow-up"], ["created", "Newest added"], ["name", "Name A–Z"]].map(([v, l]) => h("option", { value: v }, l)));
    sort.value = pane.sort;
    const selectBtn = h("button", { class: "btn ghost sm", type: "button", onclick: () => { pane.selecting = !pane.selecting; pane.picked.clear(); paintBulk(); load(false, true); } }, C.icon("select", 16), "Select");
    const bulk = h("div", { class: "bulkbar", hidden: true });
    function paintBulk() {
      selectBtn.classList.toggle("on", pane.selecting);
      selectBtn.lastChild.textContent = pane.selecting ? "Done" : "Select";
      bulk.hidden = !pane.selecting;
      const n = pane.picked.size;
      bulk.replaceChildren(h("b", null, `${n} selected`),
        h("button", { type: "button", disabled: !n, onclick: () => bulkSheet() }, "Edit…"),
        h("button", { type: "button", onclick: () => { list.querySelectorAll(".pickbox").forEach((b) => { b.checked = true; pane.picked.add(Number(b.closest(".lrow").dataset.id)); }); paintBulk(); } }, "All shown"));
    }
    async function load(append = false, keep = false) {
      if (!append) pane.offset = 0;
      const res = await C.get(`leads?${params(pane.offset)}`);
      if (!append) list.replaceChildren();
      list.querySelector(".loadmore")?.remove();
      if (!res.leads.length && !append) list.append(C.empty(pane.q ? "No lead matches." : "No leads here yet.", h("button", { class: "btn ghost", type: "button", onclick: () => C.leadSheet() }, "Add a lead")));
      for (const l of res.leads) list.append(C.leadRow(l, null, { selectable: pane.selecting, checked: pane.picked.has(l.id), selected: l.id === pane.selectedId,
        onpick: (x, on) => { on ? pane.picked.add(x.id) : pane.picked.delete(x.id); paintBulk(); } }));
      pane.offset += res.leads.length;
      count.textContent = `${res.total} lead${res.total === 1 ? "" : "s"}`;
      if (pane.offset < res.total) list.append(h("button", { class: "btn ghost loadmore", type: "button", onclick: () => load(true) }, `Show more (${res.total - pane.offset} left)`));
      const n = Object.values(pane.extra).filter((v) => v != null && v !== "").length;
      filterBtn.lastChild.textContent = n ? `Filter · ${n}` : "Filter";
      filterBtn.classList.toggle("on", !!n);
    }
    function filterSheet() {
      const f = C.form([
        { k: "status", label: "Stage", type: "select", options: C.opts(C.STATUS), half: true },
        { k: "temperature", label: "Temperature", type: "select", options: C.opts(C.TEMP), half: true },
        { k: "source", label: "Source", type: "select", options: C.opts(C.SOURCE), half: true },
        { k: "country", label: "Country", type: "select", options: C.opts(C.COUNTRY), half: true },
        { k: "icp", label: "Buyer type", type: "select", options: C.opts(C.ICP), half: true },
        { k: "lane", label: "Lane", type: "select", options: C.opts(C.LANE), half: true },
        { k: "tag", label: "Tag", placeholder: "Golden Visa", half: true },
        { k: "untouched", label: "Not touched for (days)", type: "number", half: true },
        { k: "task", label: "Follow-up", type: "chips", options: [["overdue", "Overdue"], ["open", "Has one"], ["none", "None set"]] },
        { k: "inbound", label: "Came in", type: "chips", options: [["1", "Inbound"], ["0", "Outbound"]] },
      ], pane.extra);
      const nameIn = h("input", { type: "text", placeholder: "Name this list, e.g. Hot NRIs in the US" });
      const close = C.sheet("Filter leads", h("div", null, f.el, h("h3", { class: "fh" }, "Save as a smart list"), h("div", { class: "fld" }, nameIn,
        h("small", null, "Saved lists appear next to Open, Hot… for one-tap use."))), [
        h("button", { class: "btn", type: "button", onclick: async () => {
          pane.extra = Object.fromEntries(Object.entries(f.get()).filter(([, v]) => v != null && v !== ""));
          const name = nameIn.value.trim();
          if (name) {
            const p = new URLSearchParams(params()); p.delete("limit"); p.delete("offset"); p.delete("q"); p.delete("sort");
            const lists = [...(C.settings.smart_lists || []).filter((x) => x.name !== name), { name, query: p.toString() }];
            C.settings = (await C.api("settings", { method: "PUT", body: { smart_lists: lists } })).settings;
            pane.smart = lists[lists.length - 1]; pane.extra = {};
            C.toast(`Saved “${name}”`);
          }
          close(); paintChips(); load();
        } }, "Apply"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { pane.extra = {}; close(); load(); } }, "Clear")]);
    }
    function bulkSheet() {
      const ids = [...pane.picked];
      const f = C.form([
        { k: "temperature", label: "Temperature", type: "chips", options: C.opts(C.TEMP) },
        { k: "status", label: "Stage", type: "select", options: C.opts(C.STATUS), placeholder: "Keep as is" },
        { k: "source", label: "Source", type: "select", options: C.opts(C.SOURCE), placeholder: "Keep as is" },
        { k: "add_tag", label: "Add a tag", placeholder: "Golden Visa" },
        { k: "task_title", label: "Add a follow-up to each", placeholder: "Send the new Emaar South launch", half: true },
        { k: "task_due", label: "When", type: "datetime", defaultTime: "10:00", quick: C.quickDays().slice(1, 4) },
      ], {});
      const close = C.sheet(`Edit ${ids.length} lead${ids.length > 1 ? "s" : ""}`, f.el, [
        h("button", { class: "btn", type: "button", onclick: async () => {
          const v = f.get();
          const set = Object.fromEntries(["temperature", "status", "source"].filter((k) => v[k]).map((k) => [k, v[k]]));
          try {
            await C.api("leads/bulk", { method: "POST", body: { ids, set, add_tag: v.add_tag, task: v.task_title ? { title: v.task_title, due_at: v.task_due } : null } });
            close(); pane.selecting = false; pane.picked.clear(); paintBulk(); C.toast(`Updated ${ids.length}`); C.refresh();
          } catch (e) { C.fail(e); }
        } }, "Apply"),
        h("button", { class: "btn ghost danger", type: "button", onclick: async () => {
          if (!(await C.ask(`Delete ${ids.length} leads and all their history?`, { ok: "Delete", danger: true }))) return;
          await C.api("leads/bulk", { method: "POST", body: { ids, delete: true } }); close(); pane.selecting = false; pane.picked.clear(); paintBulk(); C.refresh();
        } }, "Delete")]);
    }
    paintChips(); paintBulk();
    pane.el = h("div", { class: "leadpane" },
      h("div", { class: "lp-top" }, h("div", { class: "lp-search" }, C.icon("search", 17), search), chips,
        h("div", { class: "lp-tools" }, filterBtn, sort, selectBtn, count)),
      list, bulk);
    pane.load = load; pane.paintChips = paintChips;
    pane.mark = (id) => { pane.selectedId = id; list.querySelectorAll(".lrow").forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === id)); };
    return pane;
  }
  const getPane = () => pane.el ? pane : buildPane();
  C.route("leads", async () => {
    const p = getPane();
    p.paintChips();
    await p.load();
    return { title: "Leads", actions: [iconBtn("plus", "Add a lead", () => C.leadSheet())], body: [p.el], className: "leads-page" };
  }, { prefetch: () => [`leads?view=open&limit=100&offset=0`] });

  // Laptop: list on the left, the lead on the right; picking a lead only redraws the right side.
  C.renderSplit = async (name, arg, keepScroll, alive) => {
    const v = document.getElementById("view");
    let split = v.querySelector(":scope > .twopane");
    const p = getPane();
    if (!split) {
      split = h("div", { class: "twopane" }, h("div", { class: "pane-list" }, h("header", { class: "page-h" }, h("div", { class: "ph-row" }, h("div", { class: "ph-t" }, h("h1", null, "Leads")),
        h("div", { class: "ph-a" }, iconBtn("plus", "Add a lead", () => C.leadSheet()))))), h("div", { class: "pane-detail" }));
      v.replaceChildren(split);
      document.body.classList.add("split-on");
      keepScroll = false;
    }
    const listEl = split.querySelector(".pane-list"), detail = split.querySelector(".pane-detail");
    if (p.el.parentNode !== listEl) { listEl.append(p.el); p.paintChips(); await p.load(); }
    else if (keepScroll) { const y = p.el.querySelector(".lp-list").scrollTop; await p.load(); p.el.querySelector(".lp-list").scrollTop = y; }
    const id = name === "lead" ? Number(arg) : null;
    p.mark(id);
    if (!id) { detail.replaceChildren(h("div", { class: "pane-empty" }, C.icon("leads", 40), h("p", null, "Pick a lead, or press N to add one."))); return; }
    const pg = await C.routes.lead.fn(arg, { inSplit: true });
    if (!alive()) return;
    C.mountPage(detail, pg, keepScroll, detail);
    if (!keepScroll) detail.scrollTop = 0;
  };

  // ---------- Lead ----------
  let leadTab = "overview";
  C.route("lead", async (id, o = {}) => {
    const d = await C.get(`leads/${id}`);
    const l = d.lead;
    const lt = C.localTime(l);
    const g = C.guard(l);
    const head = h("section", { class: "card lead-h" },
      h("p", { class: "sub" }, [l.phone, l.country ? C.COUNTRY[l.country] || l.country : null, lt ? `${lt} their time` : null].filter(Boolean).join(" · ") || "No phone saved"),
      h("div", { class: "tags" }, h("span", { class: `st s-${l.status}` }, C.STATUS[l.status] || l.status), h("span", { class: "tag" }, C.tempDot(l.temperature), C.TEMP[l.temperature] || "—"),
        h("span", { class: "tag" }, C.SOURCE[l.source] || l.source), l.icp ? h("span", { class: "tag" }, C.ICP[l.icp]) : null,
        C.isUae(l) ? h("span", { class: `tag ${l.dncr === "clear" ? "ok" : l.dncr === "listed" ? "bad" : "warnt"}` }, l.dncr === "clear" ? "DNCR clear" : l.dncr === "listed" ? "On DNCR" : "DNCR not checked") : null,
        l.inbound ? h("span", { class: "tag" }, "Inbound") : null, ...(l.tags ? l.tags.split(",").map((x) => x.trim()).filter(Boolean).map((x) => h("span", { class: "tag soft" }, `#${x}`)) : [])),
      g.block ? h("p", { class: "warnbox" }, g.block) : null,
      h("div", { class: "bigacts" },
        h("button", { class: "btn", type: "button", onclick: () => C.startCall(l), disabled: !l.phone }, C.icon("call", 18), "Call"),
        h("button", { class: "btn ghost", type: "button", onclick: () => C.startWhatsApp(l), disabled: !(l.phone || l.whatsapp) }, C.icon("wa", 18), "WhatsApp"),
        h("button", { class: "btn ghost", type: "button", onclick: () => C.logSheet(l) }, C.icon("log", 18), "Log")));
    const tabs = C.seg([["overview", "Overview"], ["timeline", `Timeline · ${d.touches.length + d.meetings.length}`], ["deals", `Deals${d.deals.length ? ` · ${d.deals.length}` : ""}`]], leadTab,
      (v) => { leadTab = v; C.render(true); }, "wide lead-tabs");
    let body;
    if (leadTab === "timeline") body = timeline(d);
    else if (leadTab === "deals") body = dealsTab(d);
    else body = overview(d);
    return { title: h("span", { class: "lt" }, C.tempDot(l.temperature), l.name), back: o.inSplit ? null : ["leads", "Leads"],
      actions: [iconBtn("edit", "Edit lead", () => C.leadSheet(l))], body: [head, tabs, ...body] };
  }, { nav: "leads", split: true });

  function overview(d) {
    const l = d.lead;
    const open = d.tasks.filter((t) => !t.done_at);
    const next = C.card("Next up", null,
      open.length ? open.map((t) => C.taskRow({ ...t, lead_name: l.name }, { hideLead: true })) : h("p", { class: "muted" }, "Nothing scheduled."),
      h("div", { class: "stack row" },
        h("button", { class: "btn ghost", type: "button", onclick: () => C.taskSheet({ lead: l, title: "Follow up" }) }, C.icon("plus", 16), "Task"),
        h("button", { class: "btn ghost", type: "button", onclick: () => C.bookSheet(l) }, C.icon("calendar", 16), "Meeting"),
        h("button", { class: "btn ghost", type: "button", onclick: () => C.dealSheet(l) }, C.icon("money", 16), "Deal")));
    const dms = d.people.filter((p) => p.decision_maker);
    const people = C.card("Household & decision-makers", dms.length ? `${dms.length} decide` : "Gate 2",
      d.people.length ? d.people.map((p) => h("div", { class: "lrow" },
        h("button", { class: "lmain link-row", type: "button", onclick: () => C.personSheet(l.id, p) },
          h("b", null, h("span", { class: "nm" }, p.name), p.decision_maker ? h("span", { class: "st s-qualified" }, "Decides") : null),
          h("small", null, [C.RELATION[p.relation] || p.relation, p.phone, p.notes].filter(Boolean).join(" · "))),
        p.phone ? C.actions({ ...p, id: l.id, name: p.name, status: l.status, country: l.country, dncr: l.dncr }) : null))
        : h("p", { class: "fhint" }, "Who else has to be comfortable? Add the spouse or parents so you book them onto the call."),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => C.personSheet(l.id) }, C.icon("plus", 16), "Add person"));
    const facts = [["Real goal", C.NEED[l.need]], ["Lane", C.LANE[l.lane]], ["Budget", l.budget_min || l.budget_max ? `${C.aed(l.budget_min)}–${C.aed(l.budget_max)}` : null],
      ["Funding", l.funding], ["Who decides", l.decision_makers], ["Timeline", l.timeline], ["Nurture reason", l.nurture_reason], ["Lost reason", l.lost_reason],
      ["Job", [l.job_title, l.company].filter(Boolean).join(", ")], ["City", l.city], ["Email", l.email], ["WhatsApp", l.whatsapp], ["Source detail", l.source_detail],
      ["Referred by", d.referrer ? h("a", { href: `#lead/${d.referrer.id}` }, d.referrer.name) : null], ["Added", C.fmtDay(l.created_at)]].filter(([, v]) => v);
    const profile = C.card("Profile", null, h("dl", { class: "facts" }, facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      l.notes ? h("p", { class: "notes" }, l.notes) : null,
      !l.need && !l.lane ? h("p", { class: "fhint" }, "Gates not done yet: book the 30-minute call to find need, decision-maker and budget.") : null);
    const refs = d.referrals.length ? C.card("Referrals they gave", `${d.referrals.length}`, d.referrals.map((r) => h("a", { class: "lrow link-row", href: `#lead/${r.id}` }, h("div", { class: "lmain" }, h("b", null, r.name), h("small", null, C.STATUS[r.status]))))) : null;
    const danger = h("section", { class: "card dangerzone" }, h("div", { class: "stack row" },
      l.status !== "lost" ? h("button", { class: "btn ghost", type: "button", onclick: async () => { const r = await C.ask("Why is this lead lost?", { input: true, value: l.lost_reason || "", ok: "Mark lost" }); if (r === null) return; await C.api(`leads/${l.id}`, { method: "PATCH", body: { status: "lost", lost_reason: r } }); C.refresh(); } }, "Mark lost")
        : h("button", { class: "btn ghost", type: "button", onclick: async () => { await C.api(`leads/${l.id}`, { method: "PATCH", body: { status: "conversation", temperature: "nurture" } }); C.refresh(); } }, "Reopen"),
      h("button", { class: "btn ghost", type: "button", onclick: async () => { if (!(await C.ask("Mark as do not call?", { text: "No more calls or WhatsApps to this lead.", ok: "Do not call" }))) return; await C.api(`leads/${l.id}`, { method: "PATCH", body: { status: "dnc" } }); C.refresh(); } }, "Do not call"),
      h("button", { class: "btn ghost", type: "button", onclick: () => mergeSheet(l) }, "Merge…"),
      h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!(await C.ask(`Delete ${l.name}?`, { text: "All their calls, meetings, deals and tasks go too.", ok: "Delete", danger: true }))) return; await C.api(`leads/${l.id}`, { method: "DELETE" }); C.toast("Deleted"); location.hash = "leads"; } }, "Delete")));
    return [next, people, profile, refs, danger];
  }
  function mergeSheet(l) {
    const picker = C.leadPicker(null);
    const close = C.sheet(`Merge into ${l.name}`, h("div", null, h("p", { class: "fhint" }, "Pick the duplicate. Its calls, meetings, deals, tasks and people move here, empty fields get filled, then the duplicate is deleted."),
      h("div", { class: "fld" }, picker.el)), [h("button", { class: "btn", type: "button", onclick: async () => {
        const o = picker.get(); if (!o || o.id === l.id) return C.toast("Pick another lead");
        if (!(await C.ask(`Merge ${o.name} into ${l.name}?`, { ok: "Merge" }))) return;
        await C.api(`leads/${l.id}/merge`, { method: "POST", body: { other_id: o.id } }); close(); C.toast("Merged"); C.refresh();
      } }, "Merge")]);
  }
  function timeline(d) {
    const items = [
      ...d.touches.map((t) => ({ at: t.at, icon: t.channel === "whatsapp" ? "wa" : t.channel === "email" ? "log" : "call",
        title: `${t.channel === "whatsapp" ? "WhatsApp" : t.channel === "email" ? "Email" : "Call"}: ${C.OUTCOME[t.outcome] || t.outcome}${t.nos ? ` · ${t.nos} no${t.nos > 1 ? "s" : ""}` : ""}`, note: t.note, touch: t })),
      ...d.meetings.map((m) => ({ at: m.scheduled_at, icon: "calendar", title: `${C.MEET_KIND[m.kind] || "Meeting"} · ${C.MEET_STATUS[m.status]}${m.close_score ? ` · scored ${m.close_score}/10` : ""}`,
        note: m.status === "held" ? `Gates ${["g1_pass", "g2_pass", "g3_pass"].map((g) => (m[g] === 1 ? "✓" : m[g] === 0 ? "✗" : "·")).join(" ")}${m.to_ten ? ` · to a 10: ${m.to_ten}` : ""}` : m.notes, href: `#meeting/${m.id}` })),
      ...d.tasks.filter((t) => t.done_at).map((t) => ({ at: t.done_at, icon: "check", title: `Done: ${t.title}` })),
      ...d.activity.filter((a) => a.entity !== "task").map((a) => ({ at: a.at, icon: a.action === "stage" ? "pipeline" : "edit", title: a.detail, muted: true })),
    ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    if (!items.length) return [C.card("Timeline", null, C.empty("Nothing yet. Every call, WhatsApp, meeting and change shows up here."))];
    return [h("section", { class: "card" }, h("ol", { class: "tl" }, items.map((it) => h("li", { class: it.muted ? "muted" : "" },
      h("span", { class: "tl-i" }, C.icon(it.icon, 15)),
      h(it.href ? "a" : "div", { class: "tl-b", href: it.href || null }, h("b", null, it.title), h("small", null, C.fmtWhen(it.at)), it.note ? h("p", null, it.note) : null),
      it.touch ? h("button", { class: "x", type: "button", "aria-label": "Delete this touch", onclick: async () => { if (!(await C.ask("Delete this touch?", { ok: "Delete", danger: true }))) return; await C.api(`touches/${it.touch.id}`, { method: "DELETE" }); C.refresh(); } }, C.icon("x", 14)) : null))))];
  }
  function dealsTab(d) {
    const l = d.lead;
    const cards = d.deals.map((x) => h("section", { class: "card deal-c" },
      h("h2", null, h("span", null, `${x.project || "Deal"}${x.unit ? ` · ${x.unit}` : ""}`), h("span", { class: `st d-${x.stage}` }, C.STAGE[x.stage])),
      h("p", { class: "big" }, C.aed(x.price_aed), h("span", { class: "muted small" }, ` · your net ${C.both(C.netOf(x))} (${x.commission_pct}% × ${x.split_pct}%)`)),
      h("div", { class: "stack row" },
        h("button", { class: "btn ghost", type: "button", onclick: () => C.dealSheet(l, x) }, C.icon("edit", 16), "Edit"),
        h("button", { class: "btn ghost", type: "button", onclick: () => C.planSheet(x.id) }, C.icon("money", 16), "Payment plan"),
        x.stage !== "paid" && x.stage !== "fell_through" ? h("button", { class: "btn ghost", type: "button", onclick: () => C.advanceDeal(x) }, `→ ${C.STAGE[C.STAGES[C.STAGES.findIndex((s) => s[0] === x.stage) + 1]?.[0]] || ""}`) : null)));
    return [...cards, h("button", { class: "btn ghost full", type: "button", onclick: () => C.dealSheet(l) }, C.icon("plus", 16), "Add deal")];
  }

  // ---------- Meeting ----------
  C.route("meeting", async (id) => {
    const { meeting: m } = await C.get(`meetings/${id}`);
    const [ld, invRes] = await Promise.all([C.get(`leads/${m.lead_id}`), C.get("inventory").catch(() => ({ inventory: [] }))]);
    const lead = ld.lead;
    const inv = invRes.inventory.filter((i) => i.status === "active" && i.f_delivery && i.f_growth && i.f_payment);
    const objHints = h("div", { class: "objhints" });
    const paintObj = (keys) => objHints.replaceChildren(...(keys || []).map((k) => C.OBJ[k] ? h("div", { class: "why" }, h("b", null, C.OBJ[k].why), h("p", null, C.OBJ[k].move)) : null));
    const people = h("div", { class: "fld" }, h("label", null, "People around them"),
      ld.people.length ? h("div", { class: "chips" }, ld.people.map((p) => h("span", { class: `tag${p.decision_maker ? " ok" : ""}` }, `${p.name} · ${C.RELATION[p.relation] || p.relation || ""}${p.decision_maker ? " · decides" : ""}`))) : null,
      h("button", { class: "btn ghost sm", type: "button", onclick: () => C.personSheet(lead.id) }, C.icon("plus", 16), "Add spouse / parent"));
    const f = C.form([
      { k: "status", label: "Status", type: "chips", options: C.opts(C.MEET_STATUS), required: true },
      { type: "heading", label: "0–3 min · Rapport, then context", hint: "“Before I show you anything, I need to understand what you're actually trying to achieve, otherwise I'm just sending you brochures like every other agent. If what we have fits, I'll show you 3 options. If it doesn't, I'll tell you honestly. Fair?”" },
      { type: "heading", label: "Gate 1 · Need (ask why three layers deep)", hint: "Why Dubai, and why now? → Why that area or type? → What does this property need to do for your family in 5 years?" },
      { k: "g1_goal", label: "Real goal", type: "chips", options: C.opts(C.NEED) },
      { k: "g1_why", label: "Their why (in their words)", type: "textarea", rows: 2 },
      { k: "g1_tried", label: "Looked at other launches? What stopped them?", type: "textarea", rows: 2 },
      { k: "g1_realign", label: "Beliefs to realign", placeholder: "Guaranteed flips, rental income before handover…" },
      { k: "g1_pass", label: "Gate 1", type: "pass" },
      { type: "heading", label: "Gate 2 · Decision-maker and timeline", hint: "No decision-maker on the call → book the next call with them; don't pitch to half the decision." },
      { type: "el", el: people },
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
      { k: "lane", label: "Lane", type: "chips", options: C.opts(C.LANE) },
      { k: "belief_break", label: "Belief you broke", type: "chips", options: [["upfront", "Upfront needed"], ["allocation", "Hot launch allocation"], ["delays", "Developer delays"], ["other", "Other"]] },
      { k: "units_shown", label: "3 units shown", type: "textarea", rows: 2, placeholder: inv.length ? `Passing your filter: ${inv.slice(0, 4).map((i) => i.project).join(", ")}` : "Project · unit · price · upfront" },
      { type: "heading", label: "25–30 min · Shut up → 1–10 close", hint: "“On a scale of 1 to 10, 1 not for you, 10 lock it in today: where are you?” → “Why not lower?” → “What would make it a 10?”" },
      { k: "close_score", label: "Their score", type: "chips", num: true, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), String(n)]) },
      { k: "why_not_lower", label: "Why not lower (what they love)", type: "textarea", rows: 2 },
      { k: "to_ten", label: "What would make it a 10", type: "textarea", rows: 2 },
      { k: "objections", label: "Objections raised", type: "multi", options: C.OBJECTIONS.map((o) => [o.k, o.q]), onchange: paintObj },
      { type: "el", el: objHints },
      { type: "heading", label: "Outcome", hint: "Not today → book the decision call before you hang up. No “I'll get back to you.”" },
      { k: "outcome", label: "Result", type: "chips", options: [["eoi", "EOI / booking deposit"], ["next_call", "Decision call booked"], ["nurture", "Nurture"], ["disqualified", "Disqualified"], ["lost", "Lost"]] },
      { k: "next_call_at", label: "Next call", type: "datetime", defaultTime: "19:00", quick: C.slotQuick() },
      { k: "notes", label: "Notes", type: "textarea" },
    ], m);
    paintObj((() => { try { return JSON.parse(m.objections || "[]"); } catch (e) { return []; } })());
    const save = async () => {
      const body = f.get();
      if (body.outcome && body.status === "booked") body.status = "held";
      try {
        await C.api(`meetings/${id}`, { method: "PATCH", body });
        C.toast("Meeting saved");
        if (body.outcome === "eoi") C.dealSheet(lead, null, Number(id));
        else location.hash = `lead/${m.lead_id}`;
      } catch (e) { C.fail(e); }
    };
    const leadObj = { id: m.lead_id, name: m.name, phone: m.phone, whatsapp: m.whatsapp, country: m.country };
    return { title: `${C.MEET_KIND[m.kind] || "Meeting"}: ${m.name}`, back: [`lead/${m.lead_id}`, m.name],
      sub: `${C.fmtWhen(m.scheduled_at)} · ${m.decision_maker_joining ? "decision-maker joining" : "decision-maker not confirmed"}${m.attendees ? ` · ${m.attendees}` : ""}`,
      body: [
        m.notes && m.status === "booked" ? h("section", { class: "card" }, h("p", { class: "notes" }, m.notes)) : null,
        h("section", { class: "card" }, h("div", { class: "stack row" },
          h("button", { class: "btn ghost", type: "button", onclick: () => C.startWhatsApp(leadObj, { time: C.fmtTime(m.scheduled_at), day: C.fmtDay(m.scheduled_at) }) }, C.icon("wa", 16), "Reminder"),
          h("button", { class: "btn ghost", type: "button", onclick: () => C.downloadIcs(leadObj, m) }, C.icon("calendar", 16), "Calendar"),
          h("button", { class: "btn ghost", type: "button", onclick: () => C.bookSheet(leadObj, m) }, "Reschedule"))),
        h("section", { class: "card" }, f.el),
        h("div", { class: "savebar" }, h("button", { class: "btn", type: "button", onclick: save }, "Save meeting"))] };
  }, { nav: "pipeline" });

  // ---------- Tasks ----------
  let taskScope = "open";
  C.route("tasks", async () => {
    const { tasks } = await C.get(`tasks?scope=${taskScope}`);
    const t = C.gulfToday();
    const groups = taskScope === "done" ? [["Done", tasks]] : (() => {
      const g = { Overdue: [], Today: [], Tomorrow: [], "Next 7 days": [], Later: [], "No date": [] };
      for (const x of tasks) {
        if (!x.due_at) { g["No date"].push(x); continue; }
        const d = C.gulf(x.due_at).slice(0, 10);
        if (Date.parse(x.due_at) < Date.now() && d < t) g.Overdue.push(x);
        else if (d === t) g.Today.push(x);
        else if (d === C.addDays(t, 1)) g.Tomorrow.push(x);
        else if (d <= C.addDays(t, 7)) g["Next 7 days"].push(x);
        else g.Later.push(x);
      }
      return Object.entries(g).filter(([, v]) => v.length);
    })();
    return { title: "Tasks", sub: taskScope === "open" ? `${tasks.length} open` : "Recently done",
      actions: [iconBtn("plus", "New task", () => C.taskSheet())],
      body: [C.seg([["open", "Open"], ["done", "Done"]], taskScope, (v) => { taskScope = v; C.render(true); }, "wide"),
        ...(groups.length ? groups.map(([name, list]) => C.card(name, `${list.length}`, list.map((x) => C.taskRow(x))))
          : [C.card(null, null, C.empty("No tasks. Follow-ups you set when logging calls land here too.", h("button", { class: "btn ghost", type: "button", onclick: () => C.taskSheet() }, "Add a task")))])] };
  }, { prefetch: () => ["tasks?scope=open"] });

  // ---------- Pipeline / Calendar / Payments ----------
  const pipeTabs = (cur) => C.seg([["pipeline", "Board"], ["calendar", "Calendar"], ["payments", "Client payments"]], cur, (v) => { location.hash = v; }, "wide");
  C.route("pipeline", async () => {
    const today = C.gulfToday();
    const [dl, ms, st] = await Promise.all([C.get("deals"), C.get(`meetings?from=${today}`), C.get(`stats?from=${C.settings?.start_date || "2026-11-02"}&to=${today}`)]);
    const s = st.status;
    const funnel = [["new", "Not called"], ["attempting", "Attempting"], ["conversation", "Spoke"], ["meeting_booked", "Meeting booked"], ["meeting_held", "Met"], ["qualified", "Qualified"], ["eoi", "EOI"], ["won", "Won"]];
    const up = ms.meetings.filter((m) => m.status === "booked");
    const live = dl.deals.filter((d) => d.stage !== "fell_through");
    const cols = C.STAGES.map(([k, l]) => {
      const ds = live.filter((d) => d.stage === k);
      const total = ds.reduce((t, d) => t + C.netOf(d), 0);
      return h("div", { class: "col" }, h("h3", null, l, h("small", null, `${ds.length}${ds.length ? ` · ${C.usd(total)}` : ""}`)),
        ds.map((d) => h("div", { class: "dcard" },
          h("a", { class: "dmain", href: `#lead/${d.lead_id}`, onclick: () => { leadTab = "deals"; } },
            h("b", null, d.name), h("small", null, [d.project, d.unit].filter(Boolean).join(" · ") || "—"),
            h("span", null, `${C.aed(d.price_aed)} · net ${C.both(C.netOf(d))}`),
            d.next_payment_date ? h("small", null, `Client pays ${C.aed(d.next_payment_aed)} on ${C.fmtDay(d.next_payment_date)}`) : null,
            d.commission_expected_at && k !== "paid" ? h("small", null, `Commission expected ${C.fmtDay(d.commission_expected_at)}`) : null),
          k !== "paid" ? h("button", { class: "next", type: "button", onclick: () => C.advanceDeal(d) }, `→ ${C.STAGE[C.STAGES[C.STAGES.findIndex((x) => x[0] === k) + 1][0]]}`) : null)));
    });
    return { title: "Pipeline", sub: "Meetings → EOI → booking → commission paid", wide: true, body: [pipeTabs("pipeline"),
      C.card("Leads by stage", null, h("div", { class: "stages" }, funnel.map(([k, l]) => h("a", { href: "#leads", class: "stg" }, h("b", null, String(s[k] || 0)), h("small", null, l))))),
      h("section", { class: "card" }, h("h2", null, h("span", null, "Deals"), h("small", null, `${live.length} live`)),
        live.length ? h("div", { class: "board" }, cols) : C.empty("No deals yet. The close is the EOI or booking deposit."),
        dl.deals.some((d) => d.stage === "fell_through") ? h("details", null, h("summary", null, "Fell through"), dl.deals.filter((d) => d.stage === "fell_through").map((d) =>
          h("p", { class: "small" }, `${d.name} · ${d.project || ""} · ${d.fell_through_reason || "no reason noted"}`))) : null),
      C.card("Upcoming meetings", `${up.length}`, up.length ? up.map((m) => h("a", { class: "lrow link-row", href: `#meeting/${m.id}` },
        h("div", { class: "lmain" }, h("b", null, h("span", { class: "time" }, C.fmtWhen(m.scheduled_at)), h("span", { class: "nm" }, m.name)), h("small", null, `${C.MEET_KIND[m.kind]}${m.decision_maker_joining ? " · decision-maker joining" : " · ⚠ decision-maker not confirmed"}`))))
        : C.empty("No meetings booked. 3 qualified meetings a week is the number that matters."))] };
  }, { prefetch: () => ["deals"] });

  let calStart = null;
  C.route("calendar", async () => {
    const today = C.gulfToday();
    const start = calStart || C.mondayOf(today);
    const end = C.addDays(start, 6);
    const ag = await C.get(`agenda?from=${start}&to=${end}`);
    const days = Array.from({ length: 7 }, (_, i) => C.addDays(start, i));
    const byDay = (date) => [
      ...ag.meetings.filter((m) => C.gulf(m.scheduled_at).slice(0, 10) === date).map((m) => ({ at: m.scheduled_at, el: h("a", { class: `ev ev-m${m.status === "held" ? " held" : ""}`, href: `#meeting/${m.id}` },
        h("b", null, C.fmtTime(m.scheduled_at)), h("span", null, `${m.kind === "site_visit" ? "Site visit" : "Meeting"} · ${m.name}`)) })),
      ...ag.tasks.filter((t) => C.gulf(t.due_at).slice(0, 10) === date).map((t) => ({ at: t.due_at, el: h("button", { class: "ev ev-t", type: "button", onclick: () => C.taskSheet({ task: t }) },
        h("b", null, C.fmtTime(t.due_at)), h("span", null, `${t.title}${t.lead_name ? ` · ${t.lead_name}` : ""}`)) })),
      ...ag.payments.filter((p) => p.due_date === date).map((p) => ({ at: `${date}T00:00`, el: h("a", { class: "ev ev-p", href: `#lead/${p.lead_id}` },
        h("b", null, "Pay"), h("span", null, `${p.name} · ${C.aed(p.amount_aed)}`)) })),
    ].sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.el);
    const nav = h("div", { class: "calnav" },
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { calStart = C.addDays(start, -7); C.render(true); } }, C.icon("back", 16)),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { calStart = null; C.render(true); } }, "This week"),
      h("button", { class: "btn ghost sm", type: "button", onclick: () => { calStart = C.addDays(start, 7); C.render(true); } }, C.icon("chevron", 16)),
      h("b", null, `${C.fmt(start, { day: "numeric", month: "short" })} – ${C.fmt(end, { day: "numeric", month: "short" })}`));
    return { title: "Calendar", sub: "Meetings, tasks and client payments", wide: true,
      actions: [iconBtn("plus", "New task", () => C.taskSheet())],
      body: [pipeTabs("calendar"), nav, h("div", { class: "week" }, days.map((d) => {
        const evs = byDay(d);
        return h("section", { class: `day${d === today ? " today" : ""}${evs.length ? "" : " emptyday"}` },
          h("h3", null, h("span", null, C.fmt(d, { weekday: "short" })), h("b", null, C.fmt(d, { day: "numeric" }))), evs.length ? evs : h("p", { class: "muted small" }, "Free"));
      }))] };
  }, { nav: "pipeline" });

  C.route("payments", async () => {
    const today = C.gulfToday();
    const ag = await C.get(`agenda?from=${C.addDays(today, -365)}&to=${C.addDays(today, 120)}`);
    const late = ag.payments.filter((p) => p.due_date < today), soon = ag.payments.filter((p) => p.due_date >= today);
    return { title: "Client payments", sub: "Instalments your buyers owe the developer", wide: true, body: [pipeTabs("payments"),
      late.length ? C.card("Overdue", `${late.length}`, late.map(C.payRow)) : null,
      C.card("Coming up", `${soon.length}`, soon.length ? soon.map(C.payRow) : C.empty("Nothing scheduled. Add a payment plan on a deal (Pipeline → deal → Payment plan).")),
      h("p", { class: "fhint pad" }, "Remind clients a few days before each payment. Commission usually follows the first instalment and registration.")] };
  }, { nav: "pipeline" });
})();
