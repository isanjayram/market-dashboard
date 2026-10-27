// Sanjay Ram CRM · Numbers, Friday review, Launch Filter, Scripts, Import, Settings (notifications, portals,
// smart lists, commission, templates, backup), Duplicates, Market (the Morning Brief) and More. Starts the app.
(() => {
  "use strict";
  const C = window.CRM;
  const { h } = C;
  const iconBtn = (icon, label, onclick) => h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onclick }, C.icon(icon, 19));
  const copyRow = (t, mono) => h("button", { class: "say", type: "button", onclick: async (e) => { try { await navigator.clipboard.writeText(t); e.currentTarget.classList.add("copied"); C.toast("Copied"); } catch (er) { /* ignore */ } } },
    h("span", { class: `t${mono ? " mono" : ""}` }, t), h("span", { class: "copy" }, "Copy"));
  const moreBack = ["more", "More"];

  // ---------- Numbers ----------
  let numRange = "week";
  function ranges() {
    const today = C.gulfToday(), mon = C.mondayOf(today);
    return { week: ["This week", mon, today], last: ["Last week", C.addDays(mon, -7), C.addDays(mon, -1)],
      month: ["This month", `${today.slice(0, 7)}-01`, today], all: ["Since start", C.settings?.start_date || "2026-11-02", today] };
  }
  const statsPath = () => { const [, from, to] = ranges()[numRange]; return `stats?from=${from < to ? from : to}&to=${to}`; };
  const goalLine = (label, valAed, goalAed) => {
    const p = goalAed ? Math.min(1, valAed / goalAed) : 0;
    return h("div", { class: "kbar" }, h("div", { class: "kl" }, h("span", null, label), h("b", null, C.usd(valAed), h("em", null, ` · ${C.aed(valAed)}`))),
      h("div", { class: "track" }, h("span", { class: p >= 1 ? "full" : "", style: `width:${(p * 100).toFixed(1)}%` })));
  };
  const frow = (label, n, rate, target, isLeak) => h("div", { class: `frow${isLeak ? " leak" : ""}` }, h("span", null, label), h("b", null, String(n ?? 0)),
    h("span", { class: "fr" }, rate == null ? "" : C.pct(rate), target != null ? h("small", null, ` / ${C.pct(target)}`) : null));
  C.route("numbers", async () => {
    const [, from, to] = ranges()[numRange];
    const st = await C.get(statsPath());
    C.settings = st.settings;
    const s = st.settings, f = st.funnel, r = st.rates, g = st.goal;
    const goalAed = s.goal_usd * C.AED_PER_USD;
    const daysLeft = Math.max(0, Math.round((Date.parse(`${s.deadline}T23:59:00+04:00`) - Date.now()) / 864e5));
    const checks = [["pickup", "Pick-up", "conversations ÷ touches", f.touches, 30], ["book", "Booked", "meetings booked ÷ conversations", f.conversations, 20],
      ["show", "Show-up", "held ÷ meetings due", f.due, 3], ["close", "Close", "closed ÷ held", f.held, 3]];
    const scored = checks.filter(([k, , , n, min]) => r[k] != null && n >= min).map(([k]) => [k, r[k] / s.rates[k]]).sort((a, b) => a[1] - b[1]);
    const leak = scored.length && scored[0][1] < 1 ? scored[0][0] : null;
    const leakName = leak ? checks.find((c) => c[0] === leak)[1] : null;
    const cards = [
      C.card(`$${(s.goal_usd / 1000).toFixed(0)}K goal`, `${daysLeft} days to ${C.fmtDay(s.deadline)}`,
        C.bar(g.closed_n, s.deals_target, `Deals closed (plan for ${s.deals_buffer})`),
        h("div", { class: "goalbars" }, goalLine("Booked (closed deals, net)", g.booked_net_aed, goalAed), goalLine("Paid (cash in hand)", g.paid_net_aed, goalAed), goalLine("In EOI / allocation", g.pipeline_net_aed, goalAed)),
        h("p", { class: "fhint" }, `Net per deal assumed $${(s.net_per_deal_usd / 1000).toFixed(0)}K after Lyka's split. Developers usually pay 1–3 months after booking, so cash by April means closing by end of February.`)),
      C.card("Funnel", leak ? h("span", { class: "pill down" }, `Leak: ${leakName}`) : scored.length ? h("span", { class: "pill up" }, "On target") : "need more data",
        h("div", { class: "funnel" }, frow("Touches (dials + WhatsApp)", f.touches), frow("Conversations", f.conversations, r.pickup, s.rates.pickup, leak === "pickup"),
          frow("Meetings booked", f.booked, r.book, s.rates.book, leak === "book"), frow("Meetings held", f.held, r.show, s.rates.show, leak === "show"),
          frow("Qualified (3 gates)", f.qualified, r.qualified), frow("EOIs", f.eoi), frow("Closed (booking)", f.closed, r.close, s.rates.close, leak === "close")),
        h("p", { class: "fhint" }, leak ? `Fix ${leakName.toLowerCase()} (${checks.find((c) => c[0] === leak)[2]}) next week, not everything.` : "Rates show once there's enough data: 30 touches, 20 conversations, 3 meetings.")),
      numRange === "week" || numRange === "last" ? C.card("Weekly targets", null, C.bar(f.touches, s.weekly.touches, "Touches"), C.bar(f.conversations, s.weekly.conversations, "Conversations"),
        C.bar(f.booked, s.weekly.booked, "Meetings booked"), C.bar(f.held, s.weekly.held, "Meetings held"), C.bar(f.eoi, s.weekly.eoi, "EOI attempts")) : null,
      C.card("Speed to lead", `${st.speed.n} inbound`, st.speed.n ? h("div", { class: "cmp" },
        h("div", null, h("small", null, "Median first call"), h("b", null, st.speed.median_min == null ? "—" : `${st.speed.median_min < 1 ? "<1" : Math.round(st.speed.median_min)} min`)),
        h("div", null, h("small", null, "Within 5 min"), h("b", null, st.speed.contacted ? C.pct(st.speed.within5 / st.speed.contacted) : "—")),
        h("div", null, h("small", null, "Not called yet"), h("b", null, String(st.speed.n - st.speed.contacted)))) : C.empty("No inbound leads in this period."),
        h("p", { class: "fhint" }, "Reply to every inbound lead within 5 minutes. This alone wins deals.")),
      C.card("Sales calls", `${st.held_n} held`, st.held_n ? h("div", null,
        h("div", { class: "cmp" }, h("div", null, h("small", null, "Avg 1–10 score"), h("b", null, st.close_avg ? st.close_avg.toFixed(1) : "—")),
          h("div", null, h("small", null, "Need gate failed"), h("b", null, String(st.leaks.need))), h("div", null, h("small", null, "Decision gate failed"), h("b", null, String(st.leaks.decision)))),
        h("div", { class: "cmp" }, h("div", null, h("small", null, "Budget gate failed"), h("b", null, String(st.leaks.budget))),
          h("div", null, h("small", null, "No decision-maker"), h("b", null, String(st.leaks.no_dm))), h("div", null, h("small", null, "Qualified rate"), h("b", null, C.pct(r.qualified)))),
        Object.keys(st.objections).length ? h("div", null, h("h3", { class: "fh" }, "Objections heard"),
          Object.entries(st.objections).sort((a, b) => b[1] - a[1]).map(([k, n]) => h("div", { class: "wrow" }, h("div", null, h("b", null, C.OBJ[k]?.q || k), h("small", null, C.OBJ[k]?.why || "")), h("div", { class: "r" }, h("div", null, String(n))))),
          h("p", { class: "fhint" }, "Most of these shouldn't appear if the gates were done properly. If one does, find which gate leaked.")) : null) : C.empty("No meetings held in this period.")),
      C.card("Weekly KPI tracker", null, h("div", { class: "tscroll" }, h("table", { class: "kpi" },
        h("thead", null, h("tr", null, ["Week of", "Touches", "Conv.", "Booked", "Held", "Qualified", "EOIs", "Closed", "Net"].map((x) => h("th", null, x)))),
        h("tbody", null, [...st.weeks].reverse().map((w) => h("tr", null, h("td", null, C.fmt(w.week, { day: "numeric", month: "short" })),
          h("td", { class: w.touches >= s.weekly.touches ? "hit" : "" }, w.touches), h("td", { class: w.conversations >= s.weekly.conversations ? "hit" : "" }, w.conversations),
          h("td", { class: w.booked >= s.weekly.booked ? "hit" : "" }, w.booked), h("td", { class: w.held >= s.weekly.held ? "hit" : "" }, w.held), h("td", null, w.qualified),
          h("td", { class: w.eoi >= s.weekly.eoi ? "hit" : "" }, w.eoi), h("td", null, w.closed), h("td", null, w.net_aed ? C.usd(w.net_aed) : "")))))),
        h("p", { class: "fhint" }, `Targets: ${s.weekly.touches} touches · ${s.weekly.conversations} conversations · ${s.weekly.booked} booked · ${s.weekly.held} held · ${s.weekly.eoi} EOI. Green = hit.`)),
      C.card("Monthly targets", null, s.monthly.map((m) => {
        const n = g.months[m.month] || 0;
        return h("div", { class: "wrow" }, h("div", null, h("b", null, C.fmt(`${m.month}-01`, { month: "short", year: "numeric" })), h("small", null, m.focus)),
          h("div", { class: "r" }, h("div", { class: n >= m.low && (n > 0 || m.low === 0) ? "up" : "" }, `${n} / ${m.low === m.high ? m.high : `${m.low}–${m.high}`}`)));
      })),
      C.card("Lead sources", "all time", st.sources.length ? h("div", { class: "tscroll" }, h("table", { class: "kpi" },
        h("thead", null, h("tr", null, ["Source", "Leads", "Reached", "Met", "Won"].map((x) => h("th", null, x)))),
        h("tbody", null, st.sources.map((x) => h("tr", null, h("td", null, C.SOURCE[x.source] || x.source || "—"), h("td", null, x.leads), h("td", null, x.reached), h("td", null, x.met), h("td", null, x.won))))))
        : C.empty("No leads yet."), h("p", { class: "fhint" }, "Put your hours where leads turn into meetings.")),
    ];
    return { title: "Numbers", sub: `${C.fmtDay(from)} – ${C.fmtDay(to)}`, wide: true, actions: [h("a", { class: "btn ghost sm", href: "#review", "data-top": "no" }, "Friday review")],
      body: [C.seg(Object.entries(ranges()).map(([k, [l]]) => [k, l]), numRange, (v) => { numRange = v; C.render(true); }, "wide"), h("div", { class: "grid2" }, cards)] };
  }, { prefetch: () => [statsPath()] });

  C.route("review", async () => {
    const today = C.gulfToday(), wk = C.mondayOf(today);
    const [st, hot, nur] = await Promise.all([C.get(`stats?from=${wk}&to=${today}`), C.get("leads?temperature=hot&view=open&sort=next&limit=50"), C.get("leads?temperature=nurture&view=open&sort=next&limit=50")]);
    const s = st.settings, r = st.rates;
    const key = `crm-review-${wk}`;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { /* ignore */ }
    const tick = (k, label) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!done[k], onchange: (e) => { done[k] = e.target.checked; try { localStorage.setItem(key, JSON.stringify(done)); } catch (er) { /* ignore */ } } }), h("span", null, label));
    const checks = [["Pick-up", r.pickup, s.rates.pickup], ["Booked", r.book, s.rates.book], ["Show-up", r.show, s.rates.show], ["Close", r.close, s.rates.close]];
    const missed = checks.filter((c) => c[1] != null && c[1] < c[2]).sort((a, b) => a[1] / a[2] - b[1] / b[2]);
    return { title: "Friday review", sub: `Week of ${C.fmtDay(wk)} · 30 minutes`, back: ["numbers", "Numbers"], body: [
      C.card("1. Which conversion rate missed target?", null, checks.map(([l, v, t]) => h("div", { class: "wrow" }, h("div", null, h("b", null, l)), h("div", { class: "r" }, h("div", { class: v == null ? "" : v >= t ? "up" : "down" }, `${C.pct(v)} / ${C.pct(t)}`)))),
        h("p", { class: "fhint" }, missed.length ? `Fix ${missed[0][0].toLowerCase()} next week. Only that one.` : "Nothing below target (or not enough data yet)."), tick("q1", "Picked the one leak to fix")),
      C.card("2. Listen to 2 of your own recorded calls", null, h("p", { class: "fhint" }, "Score tonality (friendly open · calm discovery · confident price · pause) and whether you passed all three gates."), tick("q2a", "Call 1 reviewed"), tick("q2b", "Call 2 reviewed")),
      C.card("3. Update hot and nurture lists", `${hot.total} hot · ${nur.total} nurture`, h("p", { class: "fhint" }, "Hot = call this week. Nurture = monthly touch with something useful."),
        hot.leads.slice(0, 12).map((l) => C.leadRow(l)), h("details", null, h("summary", null, `Nurture list (${nur.total})`), nur.leads.map((l) => C.leadRow(l))), tick("q3", "Lists updated")),
      st.stalled.length ? C.card("Stalled deals", "no change in 14+ days", st.stalled.map((d) => h("div", { class: "wrow" }, h("div", null, h("b", null, d.name), h("small", null, `${d.project || ""} ${d.unit || ""}`)), h("div", { class: "r" }, h("div", null, C.STAGE[d.stage]))))) : null,
      C.card("4. Is my offer specific enough?", null, h("p", { class: "fhint" }, "Would a buyer pick me over 10 agents for this? “I help Indian professionals abroad buy the right off-plan property in Dubai through my Launch Filter, matched to their goal, on a payment plan they can actually fund.”"), tick("q4", "Offer checked"))] };
  }, { nav: "more" });

  // ---------- Launch Filter ----------
  function invSheet(i = null) {
    const f = C.form([
      { k: "project", label: "Project", required: true }, { k: "developer", label: "Developer", half: true }, { k: "area", label: "Area", half: true },
      { k: "lane", label: "Lane", type: "chips", options: C.opts(C.LANE) },
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
    const close = C.sheet(i ? i.project : "Add a project", f.el, [
      h("button", { class: "btn", type: "button", onclick: async () => { const b = f.get(); if (!b.project) return C.toast("Project is required");
        try { i ? await C.api(`inventory/${i.id}`, { method: "PATCH", body: b }) : await C.api("inventory", { method: "POST", body: b }); close(); C.refresh(); } catch (e) { C.fail(e); } } }, "Save"),
      i ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!(await C.ask("Delete this project?", { ok: "Delete", danger: true }))) return; await C.api(`inventory/${i.id}`, { method: "DELETE" }); close(); C.refresh(); } }, "Delete") : null]);
  }
  C.route("inventory", async () => {
    const { inventory } = await C.get("inventory");
    const body = [h("p", { class: "fhint pad" }, "Max 3 areas and 1–2 developers per area. Start with 2 lanes; add the third once you can pitch both without notes.")];
    for (const [lane, label] of [...C.opts(C.LANE), [null, "No lane"]]) {
      const items = inventory.filter((i) => (i.lane || null) === lane);
      if (!items.length) continue;
      body.push(C.card(label, `${items.length}`, items.map((i) => {
        const pass = i.f_delivery && i.f_growth && i.f_payment;
        return h("button", { class: "lrow link-row", type: "button", onclick: () => invSheet(i) }, h("div", { class: "lmain" },
          h("b", null, h("span", { class: "nm" }, i.project), h("span", { class: `st ${pass ? "s-won" : "s-lost"}` }, pass ? "Passes" : "Fails filter"), i.status !== "active" ? h("span", { class: "tag" }, i.status === "sold_out" ? "Sold out" : "Archived") : null),
          h("small", null, [i.developer, i.area, i.price_from_aed ? `from ${C.aed(i.price_from_aed)}` : null, i.down_payment_pct ? `${i.down_payment_pct}% down` : null,
            i.commission_pct != null ? `${i.commission_pct}% commission` : null, i.handover ? `handover ${i.handover}` : null].filter(Boolean).join(" · ")),
          h("small", null, `${i.f_delivery ? "✓" : "✗"} delivery record  ${i.f_growth ? "✓" : "✗"} growth driver  ${i.f_payment ? "✓" : "✗"} payment-plan fit${i.eoi_deadline ? ` · EOI by ${C.fmtDay(i.eoi_deadline)}` : ""}`)));
      })));
    }
    if (!inventory.length) body.push(C.card("No projects yet", null, C.empty("Pick your lanes and 1–2 developers per lane, then add the launches that pass.", h("button", { class: "btn", type: "button", onclick: () => invSheet() }, "Add a project"))));
    return { title: "Launch Filter", sub: "Every unit passes 3 filters before a client sees it", back: moreBack, actions: [iconBtn("plus", "Add a project", () => invSheet())], body };
  }, { nav: "more" });

  // ---------- Scripts ----------
  C.route("scripts", async () => {
    const blk = (title, sub, lines) => C.card(title, sub, lines.map((x) => (typeof x === "string" ? copyRow(x) : x)));
    return { title: "Scripts", sub: "Say them out loud until they take under 10 seconds", back: moreBack, wide: true, body: [h("div", { class: "grid2" },
      blk("Value proposition", "X through Y to get Z", ["I help Indian professionals abroad buy the right off-plan property in Dubai through my Launch Filter, matched to their goal, on a payment plan they can actually fund."]),
      blk("Cold call", "a ladder: each step buys 10 seconds", [h("p", { class: "fhint" }, "Goal: a booked meeting, permission to stay in touch, or a referral. Hang up only after three nos."),
        "Ravi! How are you doing?", "It's Sanjay from Lyka Realty. Is this a good time?",
        "I help Indian professionals buy off-plan in Dubai: waterfront, growth areas or the best-value launches, on payment plans they can fund from salary. Is owning in Dubai something you've been thinking about?",
        "Totally understand. Before I let you go: are you not looking at all, or just not right now?",
        "No problem. Can I WhatsApp you when a launch fits what you described? I only send the ones that pass my filter.", "Who in your circle has been talking about buying in Dubai?"]),
      blk("BANT", "“I don't want to waste your time with options that don't fit. Can I ask four quick questions?”", ["Is this for investment, to live in, or for residency for the family?",
        "What range are you comfortable with, and would it be cash or with a mortgage?", "Who else is part of this decision: your wife, parents, a business partner?", "When are you looking to move: this launch, or in the next 6 months?"]),
      blk("Book the meeting", "two slots, never “when are you free?”", ["Here's what I'll do: I'll shortlist 3 villas that fit what you told me and walk you through them on a 30-minute video call. I have Thursday at 11 or Saturday at 2. Which is better? And can your wife join?"]),
      blk("Sales call: context", null, ["Before I show you anything, I need to understand what you're actually trying to achieve, otherwise I'm just sending you brochures like every other agent. If what we have fits, I'll show you 3 options. If it doesn't, I'll tell you honestly. Fair?"]),
      blk("The 3 Gates", "align, educate or disqualify at every gate", ["Why Dubai, and why now?", "Why that area or property type?", "What does this property need to do for your family in 5 years?",
        "Have you looked at other launches? What stopped you?", "Who else needs to be comfortable with this?", "When would you want to lock in a unit?",
        "What range are you comfortable investing, including the down payment?", "Villas in this area run from roughly [low] to [high]. Where do you sit?",
        "Is it that the funds aren't there, or that you'd rather not put that much into one property?", "If I show you a unit that fits everything you've told me, at around [X] with [Y]% upfront, would you be ready to move on it?"]),
      blk("Belief-break + pitch", null, ["How much do you think you need upfront to own an AED 2M villa?", "Do you think the best units in a hot launch go to whoever calls first on launch day?",
        "Every unit I show passes my Launch Filter: developer delivery record, location growth driver, payment-plan fit.", "EOI, allocation, booking, SPA, Oqood registration, construction updates, handover, leasing. You do the decisions; I handle the rest."]),
      blk("The close", "then stop talking", ["On a scale of 1 to 10, 1 not for you, 10 lock it in today: where are you?", "Why not lower?", "What would make it a 10?",
        "Let's secure the EOI now. It holds your place in the allocation.", "Earlier you said you were ready to decide now. What changed?"]),
      C.card("Objections", "agree → ask why → isolate → realign or educate", h("p", { class: "fhint" }, "“If we solve this, are you ready today?”"),
        C.OBJECTIONS.map((o) => h("details", { class: "obj" }, h("summary", null, `“${o.q}”`), h("p", { class: "small muted" }, o.why), copyRow(o.move)))),
      C.card("Compliance", "material risk", h("ul", { class: "brief" }, ["UAE numbers: call only 9 AM–6 PM.", "Never call numbers on the Do Not Call Registry (DNCR).",
        "If they say no, don't call back the same day; no excessive follow-ups.", "No pressure or misleading claims. Never promise returns or guaranteed appreciation (RERA).",
        "Ask Lyka which number and process to use for marketing calls, and whether calls must be recorded and logged."].map((x) => h("li", null, x)))))] };
  }, { nav: "more" });

  // ---------- Import ----------
  function parseCsv(text) {
    const head = text.split(/\r?\n/)[0] || "";
    const delim = [",", ";", "\t"].sort((a, b) => head.split(b).length - head.split(a).length)[0];
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
  C.route("import", async () => {
    const res = h("div");
    const defs = C.form([
      { k: "source", label: "Source for these leads", type: "chips", options: C.opts(C.SOURCE), required: true },
      { k: "country", label: "Default country (numbers without +code)", type: "chips", options: [["AE", "UAE"], ["IN", "India"], ["US", "USA"]] },
      { k: "icp", label: "Buyer type", type: "chips", options: C.opts(C.ICP) },
    ], { source: "lyka", icp: "nri" });
    const area = h("textarea", { rows: 6, placeholder: "Paste CSV here (first row = column names), or pick a file below." });
    const file = h("input", { type: "file", accept: ".csv,text/csv,.txt" });
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
    file.addEventListener("change", async () => { if (file.files[0]) { area.value = await file.files[0].text(); preview(); } });
    area.addEventListener("input", () => { clearTimeout(area._t); area._t = setTimeout(preview, 300); });
    const go = h("button", { class: "btn", type: "button", onclick: async () => {
      if (!parsed) return C.toast("Nothing to import");
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
        const r = await C.api("import", { method: "POST", body: { rows, source: d.source, country: d.country, icp: d.icp } });
        res.replaceChildren(h("p", { class: "warnbox ok" }, `Added ${r.added} · skipped ${r.skipped} already in the CRM · ${r.invalid} empty rows`), h("a", { class: "btn", href: "#today" }, "Go to today's list"));
        area.value = ""; parsed = null; prevEl.replaceChildren();
      } catch (e) { C.fail(e); } finally { go.disabled = false; }
    } }, "Import leads");
    return { title: "Import", sub: "Lyka CRM export, Apollo, LinkedIn, your contacts", back: moreBack, body: [
      h("section", { class: "card" }, defs.el, h("div", { class: "fld" }, h("label", null, "CSV"), area, file), prevEl, h("div", { class: "stack" }, go), res),
      h("p", { class: "fhint pad" }, "Duplicates are skipped by phone number. UAE numbers like 050… become +97150…; Indian 10-digit mobiles become +91…. Purchased owner databases: check with Lyka the data is legally sourced first.")] };
  }, { nav: "more" });

  // ---------- Duplicates ----------
  C.route("duplicates", async () => {
    const { groups } = await C.api("duplicates");
    return { title: "Duplicates", sub: "Same phone, email or full name", back: moreBack, body: groups.length ? groups.map((g) => C.card(g.reason, `${g.leads.length} leads`,
      g.leads.map((l) => h("div", { class: "lrow" }, h("a", { class: "lmain", href: `#lead/${l.id}` }, h("b", null, h("span", { class: "nm" }, l.name), h("span", { class: `st s-${l.status}` }, C.STATUS[l.status])),
        h("small", null, [l.phone, l.email, C.SOURCE[l.source], `added ${C.fmtDay(l.created_at)}`].filter(Boolean).join(" · "))),
        h("button", { class: "btn ghost sm", type: "button", onclick: async () => {
          const others = g.leads.filter((x) => x.id !== l.id);
          if (!(await C.ask(`Keep ${l.name} and merge ${others.length} into it?`, { text: "Calls, meetings, deals, tasks and people move over; the others are deleted.", ok: "Merge" }))) return;
          for (const o of others) await C.api(`leads/${l.id}/merge`, { method: "POST", body: { other_id: o.id } });
          C.toast("Merged"); C.render(true);
        } }, "Keep this"))))) : [C.card(null, null, C.empty("No duplicates found."))] };
  }, { nav: "more" });

  // ---------- Settings ----------
  const PORTALS = [["portal", "Website / form", "Website form"], ["propertyfinder", "Property Finder", "Property Finder"], ["bayut", "Bayut", "Bayut"],
    ["dubizzle", "Dubizzle", "Dubizzle"], ["meta", "Meta lead ads (via Zapier/Make)", "Meta lead ads"]];
  async function pushCard() {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const reg = supported ? await navigator.serviceWorker.getRegistration() : null;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const status = h("p", { class: "fhint" });
    const btns = h("div", { class: "stack row" });
    const paint = (on) => {
      status.textContent = !supported ? (ios && !standalone ? "On iPhone: open this app from the home-screen icon (Safari → Share → Add to Home Screen), then come back here." : "This browser can't show notifications.")
        : on ? "On for this device: inbound leads, meetings (60 and 10 min before), due tasks and the morning plan." : Notification.permission === "denied" ? "Blocked in this phone's settings. Allow notifications for this app, then try again." : "Off on this device.";
      btns.replaceChildren(...(!supported ? [] : on ? [
        h("button", { class: "btn ghost", type: "button", onclick: async () => { const r = await C.api("push/test", { method: "POST" }); C.toast(r.sent ? "Sent: check your notifications" : "Couldn't send"); } }, "Send a test"),
        h("button", { class: "btn ghost", type: "button", onclick: async () => { const r2 = await navigator.serviceWorker.getRegistration(); const s2 = await r2?.pushManager.getSubscription(); if (s2) { await C.api("push/unsubscribe", { method: "POST", body: { endpoint: s2.endpoint } }); await s2.unsubscribe(); } paint(false); } }, "Turn off"),
      ] : [h("button", { class: "btn", type: "button", onclick: async () => {
        try {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") { paint(false); return; }
          const r2 = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
          const { publicKey } = await C.api("push/key");
          const pad = "=".repeat((4 - (publicKey.length % 4)) % 4);
          const raw = Uint8Array.from(atob((publicKey + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
          const s2 = await r2.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
          await C.api("push/subscribe", { method: "POST", body: { subscription: s2.toJSON(), device: `${ios ? "iPhone" : navigator.platform || "Device"} · ${new Date().toISOString().slice(0, 10)}` } });
          paint(true); C.toast("Notifications on");
        } catch (e) { C.fail(e); }
      } }, C.icon("bell", 16), "Turn on notifications")]));
    };
    paint(!!sub);
    return C.card("Phone notifications", sub ? h("span", { class: "pill up" }, "On") : h("span", { class: "pill flat" }, "Off"), status, btns);
  }
  C.route("settings", async () => {
    const r = await C.api("settings");
    const s = r.settings;
    const f = C.form([
      { type: "heading", label: "Goal" },
      { k: "goal_usd", label: "Goal ($ net)", type: "money", half: true }, { k: "net_per_deal_usd", label: "Net per deal ($)", type: "money", half: true },
      { k: "deals_target", label: "Deals needed", type: "number", half: true }, { k: "deals_buffer", label: "Deals planned (buffer)", type: "number", half: true },
      { k: "start_date", label: "Start date", type: "date", half: true }, { k: "deadline", label: "Deadline", type: "date", half: true },
      { type: "heading", label: "Activity targets" },
      { k: "daily_touches", label: "Touches per day", type: "number", half: true },
      { k: "w_touches", label: "Weekly touches", type: "number", half: true }, { k: "w_conversations", label: "Weekly conversations", type: "number", half: true },
      { k: "w_booked", label: "Weekly booked", type: "number", half: true }, { k: "w_held", label: "Weekly held", type: "number", half: true }, { k: "w_eoi", label: "Weekly EOIs", type: "number", half: true },
      { type: "heading", label: "Assumed rates (recalibrate after 200 dials)" },
      { k: "r_pickup", label: "Pick-up %", type: "number", half: true, step: "0.1" }, { k: "r_book", label: "Booked % of conversations", type: "number", half: true, step: "0.1" },
      { k: "r_show", label: "Show-up %", type: "number", half: true, step: "0.1" }, { k: "r_close", label: "Close % of held", type: "number", half: true, step: "0.1" },
    ], { ...s, w_touches: s.weekly.touches, w_conversations: s.weekly.conversations, w_booked: s.weekly.booked, w_held: s.weekly.held, w_eoi: s.weekly.eoi,
      r_pickup: +(s.rates.pickup * 100).toFixed(1), r_book: +(s.rates.book * 100).toFixed(1), r_show: +(s.rates.show * 100).toFixed(1), r_close: +(s.rates.close * 100).toFixed(1) });
    const comm = C.form([
      { k: "split_pct", label: "Lyka split: yours %", type: "number", half: true },
      { k: "commission_pct", label: "Commission if developer not listed %", type: "number", half: true, step: "0.1" }], s);
    const devRow = (x = {}) => ({ dev: h("input", { type: "text", value: x.developer || "", placeholder: "Developer", "aria-label": "Developer" }),
      pct: h("input", { type: "number", value: x.pct ?? "", step: "0.1", class: "tiny", placeholder: "%", "aria-label": "Commission %", inputmode: "decimal" }) });
    const devEls = (s.developer_commissions || []).map(devRow);
    const devWrap = h("div", null, devEls.map((x) => h("div", { class: "devrow" }, x.dev, x.pct, h("span", null, "%"))));
    const monthEls = s.monthly.map((m) => ({ m, low: h("input", { type: "number", value: m.low, class: "tiny", "aria-label": `${m.month} low` }), high: h("input", { type: "number", value: m.high, class: "tiny", "aria-label": `${m.month} high` }),
      focus: h("input", { type: "text", value: m.focus, "aria-label": `${m.month} focus` }) }));
    const tplEls = s.templates.map((t) => ({ name: h("input", { type: "text", value: t.name }), text: h("textarea", { rows: 3, value: t.text }) }));
    const tplWrap = h("div", null, tplEls.map((t) => h("div", { class: "tplrow" }, t.name, t.text)));
    const smartWrap = h("div", null, (s.smart_lists || []).map((sl, i) => h("div", { class: "wrow" }, h("div", null, h("b", null, sl.name), h("small", { class: "mono" }, sl.query)),
      h("button", { class: "linkbtn", type: "button", onclick: async () => { const lists = s.smart_lists.filter((_, j) => j !== i); C.settings = (await C.api("settings", { method: "PUT", body: { smart_lists: lists } })).settings; C.render(true); } }, "Remove"))));
    const save = async () => {
      const v = { ...f.get(), ...comm.get() };
      const body = { goal_usd: v.goal_usd, net_per_deal_usd: v.net_per_deal_usd, deals_target: v.deals_target, deals_buffer: v.deals_buffer, start_date: v.start_date, deadline: v.deadline,
        commission_pct: v.commission_pct, split_pct: v.split_pct, daily_touches: v.daily_touches,
        weekly: { touches: v.w_touches, conversations: v.w_conversations, booked: v.w_booked, held: v.w_held, eoi: v.w_eoi },
        rates: { pickup: v.r_pickup / 100, book: v.r_book / 100, show: v.r_show / 100, close: v.r_close / 100 },
        monthly: monthEls.map(({ m, low, high, focus }) => ({ month: m.month, focus: focus.value, low: Number(low.value) || 0, high: Number(high.value) || 0 })),
        developer_commissions: devEls.map((x) => ({ developer: x.dev.value.trim(), pct: Number(x.pct.value) })).filter((x) => x.developer && x.pct > 0),
        templates: tplEls.map((t) => ({ name: t.name.value.trim(), text: t.text.value.trim() })).filter((t) => t.name && t.text) };
      try { C.settings = (await C.api("settings", { method: "PUT", body })).settings; C.toast("Settings saved"); } catch (e) { C.fail(e); }
    };
    return { title: "Settings", back: moreBack, wide: true, body: [h("div", { class: "grid2" },
      await pushCard(),
      C.card("Inbound leads → 5-minute alert", null, h("p", { class: "fhint" }, "Point each source at its own address. Every POST (JSON or form: name, phone, email, project, message) adds a hot lead, a “call within 5 minutes” task and a notification."),
        r.inbound_url ? PORTALS.map(([src, label, portal]) => h("div", { class: "portal" }, h("small", { class: "glabel" }, label), copyRow(`${r.inbound_url}&source=${src}&portal=${encodeURIComponent(portal)}`, true)))
          : h("p", { class: "muted" }, "Needs DASHBOARD_PASSWORD on the server.")),
      C.card("Commission", "agency % per developer, then Lyka's split", comm.el, devWrap,
        h("button", { class: "btn ghost sm", type: "button", onclick: () => { const x = devRow(); devEls.push(x); devWrap.append(h("div", { class: "devrow" }, x.dev, x.pct, h("span", null, "%"))); x.dev.focus(); } }, C.icon("plus", 16), "Add developer")),
      h("section", { class: "card" }, f.el),
      C.card("Monthly deal targets", null, monthEls.map(({ m, low, high, focus }) => h("div", { class: "mrow" }, h("b", null, m.month), low, h("span", null, "–"), high, focus))),
      C.card("WhatsApp templates", "{first} = first name, {time} = meeting time", tplWrap,
        h("button", { class: "btn ghost sm", type: "button", onclick: () => { const t = { name: h("input", { type: "text", placeholder: "Name" }), text: h("textarea", { rows: 3 }) }; tplEls.push(t); tplWrap.append(h("div", { class: "tplrow" }, t.name, t.text)); } }, C.icon("plus", 16), "Add template")),
      C.card("Smart lists", "saved filters on Leads", (s.smart_lists || []).length ? smartWrap : C.empty("Make one from Leads → Filter → Save as a smart list.")),
      C.card("Backup", null, h("p", { class: "fhint" }, "Your data lives in Cloudflare D1 (7 days of point-in-time restore on the free plan). Download a copy every Friday."),
        h("div", { class: "stack row" }, h("a", { class: "btn ghost", href: "/api/crm/export?table=all" }, "Full backup (JSON)"),
          ["leads", "touches", "meetings", "deals", "tasks", "installments"].map((t) => h("a", { class: "btn ghost sm", href: `/api/crm/export?table=${t}` }, `${t[0].toUpperCase()}${t.slice(1)} CSV`))))),
      h("div", { class: "savebar" }, h("button", { class: "btn", type: "button", onclick: save }, "Save settings"))] };
  }, { nav: "more" });

  // ---------- Market (the Morning Brief inside the CRM) ----------
  const SUBS = [["brief", "Brief"], ["market", "Sales"], ["rent", "Rent"], ["news", "News"], ["more", "Projects"]];
  let marketJs = null;
  const loadMarketJs = () => marketJs || (marketJs = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = "/crm/market.js"; s.onload = ok; s.onerror = no; document.head.append(s);
  }));
  C.route("market", async (sub) => {
    sub = SUBS.some(([k]) => k === sub) ? sub : "brief";
    const [html] = await Promise.all([C.get("/market/fragment.html"), loadMarketJs().catch(() => null)]);
    const box = h("div", { class: "mk", "data-sub": sub });
    box.innerHTML = html; // our own build output (escaped by the template), not user data
    const ui = window.MarketUI ? window.MarketUI.init(box) : null;
    if (sub === "news") ui?.loadArchive();
    return { title: "Market", sub: "Morning Brief · DLD sales, rent, news, projects", wide: true,
      body: [C.seg(SUBS, sub, (v) => { location.hash = `market/${v}`; }, "wide scroll"), box] };
  }, { prefetch: () => ["/market/fragment.html", "/market/brief.json"] });

  // ---------- More ----------
  C.route("more", async () => {
    const item = (href, icon, title, sub) => h("a", { class: "lrow link-row menu", href }, h("span", { class: "mi" }, C.icon(icon, 19)), h("div", { class: "lmain" }, h("b", null, title), h("small", null, sub)), C.icon("chevron", 16));
    return { title: "More", body: [
      h("section", { class: "card list" },
        item("#tasks", "tasks", "Tasks", "Follow-ups, calls and your own to-dos"),
        item("#calendar", "calendar", "Calendar", "Meetings, tasks and client payments by day"),
        item("#numbers", "numbers", "Numbers", "Funnel, leak, weekly KPIs, $100K goal"),
        item("#review", "check", "Friday review", "The 30-minute weekly check")),
      h("section", { class: "card list" },
        item("#inventory", "pipeline", "Launch Filter", "Projects per lane, checked against your 3 filters"),
        item("#scripts", "log", "Scripts & objections", "Cold call, BANT, the 3 Gates, the close"),
        item("#import", "plus", "Import leads", "CSV from Lyka, Apollo, LinkedIn, contacts"),
        item("#duplicates", "people", "Duplicates", "Find and merge the same person added twice")),
      h("section", { class: "card list" },
        item("#settings", "bell", "Settings", "Notifications, portals, commission, targets, backup"),
        item("/brief/", "market", "Standalone Morning Brief", "The old one-page dashboard"),
        h("button", { class: "lrow link-row menu", type: "button", onclick: () => {
          const light = document.documentElement.dataset.theme !== "light";
          if (light) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
          try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) { /* ignore */ }
          C.paintChrome();
        } }, h("span", { class: "mi" }, C.icon("edit", 19)), h("div", { class: "lmain" }, h("b", null, "Light / dark"), h("small", null, "Switch the look on this device"))),
        h("a", { class: "lrow link-row menu", href: "/__logout" }, h("span", { class: "mi" }, C.icon("x", 19)), h("div", { class: "lmain" }, h("b", null, "Sign out"), h("small", null, "On this device")))),
      h("p", { class: "muted", style: "font-size:11px;text-align:center;margin:18px 0 0" }, `Screen ${screen.height} · page ${innerHeight} · frame ${Math.round(document.body.getBoundingClientRect().height)}`)] };
  });

  C.start();
})();
