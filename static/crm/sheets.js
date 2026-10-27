// Sanjay Ram CRM · sheets: calling (compliance guard, tel/WhatsApp, auto log on return), the call log,
// tasks, lead / meeting / deal / payment-plan / household forms, and the list rows used everywhere.
(() => {
  "use strict";
  const C = window.CRM;
  const { h } = C;

  // ---------- rows ----------
  C.paintTimer = (el) => {
    const m = (Date.now() - Date.parse(el.dataset.since)) / 6e4;
    el.textContent = m < 60 ? `waiting ${m < 1 ? "<1" : Math.floor(m)} min` : `waiting since ${C.fmtWhen(el.dataset.since)}`;
    el.classList.toggle("over", m > 5);
    return el;
  };
  C.actions = (lead) => h("div", { class: "acts" },
    lead.phone ? h("button", { class: "ab call", type: "button", "aria-label": `Call ${lead.name}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); C.startCall(lead); } }, C.icon("call", 18)) : null,
    (lead.whatsapp || lead.phone) ? h("button", { class: "ab wa", type: "button", "aria-label": `WhatsApp ${lead.name}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); C.startWhatsApp(lead); } }, C.icon("wa", 18)) : null,
    h("button", { class: "ab", type: "button", "aria-label": `Log a touch for ${lead.name}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); C.logSheet(lead); } }, C.icon("log", 18)));
  C.leadRow = (l, mode, opts = {}) => {
    const bits = [];
    if (mode === "inbound") bits.push(C.paintTimer(h("span", { class: "timer", "data-since": l.inbound_at })));
    if (l.next_action_at && mode !== "fresh") bits.push(h("span", { class: Date.parse(l.next_action_at) < Date.now() ? "late" : "" }, `${l.next_action || "Follow up"} · ${C.fmtWhen(l.next_action_at)}`));
    if (l.last_outcome) bits.push(`${C.OUTCOME[l.last_outcome] || l.last_outcome} ${C.ago(l.last_touch_at)}`);
    else bits.push(C.SOURCE[l.source] || l.source || "");
    const lt = C.localTime(l);
    if (lt) bits.push(`${lt} their time`);
    const row = h("div", { class: `lrow${opts.selected ? " sel" : ""}`, "data-id": l.id },
      opts.selectable ? h("input", { type: "checkbox", class: "pickbox", checked: opts.checked, "aria-label": `Select ${l.name}`, onclick: (e) => { e.stopPropagation(); opts.onpick?.(l, e.target.checked); } }) : null,
      h("a", { href: `#lead/${l.id}`, class: "lmain", onclick: opts.selectable ? (e) => { e.preventDefault(); const b = row.querySelector(".pickbox"); b.checked = !b.checked; opts.onpick?.(l, b.checked); } : null },
        h("b", null, C.tempDot(l.temperature), h("span", { class: "nm" }, l.name), l.status && !["new", "attempting"].includes(l.status) ? h("span", { class: `st s-${l.status}` }, C.STATUS[l.status]) : null),
        h("small", null, bits.filter(Boolean).flatMap((b, i) => (i ? [" · ", b] : [b])))),
      opts.selectable ? null : C.actions(l));
    return opts.selectable ? row : C.swipeable(row, { right: l.phone ? () => C.startCall(l) : null, left: () => C.logSheet(l) });
  };
  C.taskRow = (t, opts = {}) => {
    const late = t.due_at && !t.done_at && Date.parse(t.due_at) < Date.now();
    return h("div", { class: `trow${t.done_at ? " done" : ""}` },
      h("button", { class: "tick", type: "button", "aria-label": t.done_at ? "Mark not done" : "Mark done", "aria-pressed": String(!!t.done_at),
        onclick: async (e) => {
          const b = e.currentTarget; b.setAttribute("aria-pressed", String(!t.done_at)); b.closest(".trow").classList.toggle("done", !t.done_at);
          const r = await C.api(`tasks/${t.id}`, { method: "PATCH", body: { done: !t.done_at }, queue: true }).catch(C.fail);
          if (r) { if (!t.done_at) C.toast("Done ✓", { label: "Undo", fn: () => C.api(`tasks/${t.id}`, { method: "PATCH", body: { done: false } }).then(C.refresh) }); C.refresh(); }
        } }, C.icon("check", 16)),
      h("button", { class: "tmain", type: "button", onclick: () => C.taskSheet({ task: t }) },
        h("b", null, t.priority ? h("span", { class: "prio" }, "!") : null, t.title),
        h("small", null, [t.due_at ? h("span", { class: late ? "late" : "" }, C.fmtWhen(t.due_at)) : "No date",
          t.kind && t.kind !== "follow_up" ? C.TASK_KIND[t.kind] : null, !opts.hideLead && t.lead_name ? t.lead_name : null].filter(Boolean).flatMap((b, i) => (i ? [" · ", b] : [b])))),
      t.lead_id && !opts.hideLead ? h("a", { class: "ab", href: `#lead/${t.lead_id}`, "aria-label": `Open ${t.lead_name}` }, C.icon("chevron", 16)) : null);
  };

  // ---------- calling ----------
  const PENDING = "crm-pending-call";
  C.guard = (lead) => {
    const out = { block: null, warn: [] };
    if (lead.status === "dnc") out.block = "They asked not to be called. Don't call this number.";
    const [startH, endH] = C.settings?.calling_hours || [9, 18];
    if (C.isUae(lead)) {
      if (lead.dncr === "listed") out.block = "This UAE number is on the Do Not Call Registry.";
      const hr = C.gulfHour();
      if (!out.block && (hr < startH || hr >= endH)) out.block = `UAE rules: calls to UAE numbers only ${startH} AM–${endH - 12} PM Gulf time. It's ${C.fmtTime(new Date().toISOString())} now.`;
      if (!out.block && lead.dncr !== "clear") out.warn.push("DNCR not checked for this UAE number yet.");
    } else {
      const lh = C.localHour(lead);
      if (lh < 9 || lh >= 21) out.warn.push(`It's ${C.localTime(lead) || C.fmtTime(new Date().toISOString())} for them.`);
    }
    if (lead.last_no_at && C.gulf(lead.last_no_at).slice(0, 10) === C.gulfToday()) {
      const msg = "They said no today. No same-day call back.";
      if (C.isUae(lead)) out.block = out.block || msg; else out.warn.push(msg);
    }
    return out;
  };
  C.startCall = (lead) => {
    if (!lead.phone) return C.toast("No phone number saved");
    const g = C.guard(lead);
    const go = () => {
      try { sessionStorage.setItem(PENDING, JSON.stringify({ id: lead.id, channel: "call", at: Date.now() })); } catch (e) { /* ignore */ }
      location.href = `tel:${lead.phone}`;
      setTimeout(() => { if (document.visibilityState === "visible") resumeLog(); }, 1500); // laptop: no phone app
    };
    if (g.block) {
      const close = C.sheet("Hold on", h("p", { class: "warnbox" }, g.block),
        [h("button", { class: "btn", type: "button", onclick: () => { close(); C.taskSheet({ lead, title: "Call back", kind: "call" }); } }, "Schedule instead"),
         h("button", { class: "btn ghost", type: "button", onclick: () => close() }, "OK")], { noFocus: true });
      return;
    }
    if (g.warn.length) {
      const needsDncr = C.isUae(lead) && lead.dncr !== "clear";
      const btns = needsDncr ? [
        h("button", { class: "btn", type: "button", onclick: async () => { await C.api(`leads/${lead.id}`, { method: "PATCH", body: { dncr: "clear" } }); lead.dncr = "clear"; close(); go(); } }, "Checked: not on DNCR, call"),
        h("button", { class: "btn ghost danger", type: "button", onclick: async () => { await C.api(`leads/${lead.id}`, { method: "PATCH", body: { dncr: "listed" } }); close(); C.toast("Marked as on the DNCR"); C.refresh(); } }, "It's on the DNCR"),
      ] : [h("button", { class: "btn", type: "button", onclick: () => { close(); go(); } }, "Call anyway")];
      const close = C.sheet("Before you call", h("div", null, g.warn.map((w) => h("p", { class: "warnbox soft" }, w)),
        needsDncr ? h("p", { class: "fhint" }, "Check the number on the DNCR (ask Lyka for the process), then confirm here once. Fines run to AED 50,000.") : null),
        [...btns, h("button", { class: "btn ghost", type: "button", onclick: () => close() }, "Cancel")], { noFocus: true });
      return;
    }
    go();
  };
  const fill = (text, lead, extra = {}) => text.replace(/\{first\}/g, C.first(lead.name)).replace(/\{name\}/g, lead.name || "")
    .replace(/\{time\}/g, extra.time || "").replace(/\{day\}/g, extra.day || "").replace(/\{amount\}/g, extra.amount || "").replace(/\{date\}/g, extra.date || "");
  C.startWhatsApp = (lead, extra = {}) => {
    const num = C.digits(lead.whatsapp || lead.phone);
    if (!num) return C.toast("No WhatsApp number saved");
    if (lead.status === "dnc") return C.toast("They asked not to be contacted");
    const send = (text) => {
      try { sessionStorage.setItem(PENDING, JSON.stringify({ id: lead.id, channel: "whatsapp", at: Date.now() })); } catch (e) { /* ignore */ }
      close();
      window.open(`https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank", "noopener");
    };
    const tpl = [...(extra.preset ? [{ name: extra.preset.name, text: extra.preset.text }] : []), ...(C.settings?.templates || [])];
    const close = C.sheet(`WhatsApp ${C.first(lead.name)}`, h("div", { class: "tpls" },
      tpl.map((t) => { const text = fill(t.text, lead, extra); return h("button", { class: "tpl", type: "button", onclick: () => send(text) }, h("b", null, t.name), h("span", null, text)); }),
      h("button", { class: "tpl", type: "button", onclick: () => send("") }, h("b", null, "Blank message"), h("span", null, "Open the chat and type your own."))), null, { noFocus: true });
  };
  function resumeLog() {
    let p;
    try { p = JSON.parse(sessionStorage.getItem(PENDING) || "null"); sessionStorage.removeItem(PENDING); } catch (e) { p = null; }
    if (!p || Date.now() - p.at > 3 * 3600e3 || !p.id) return;
    C.get(`leads/${p.id}`).then((d) => C.logSheet(d.lead, p.channel)).catch(() => {});
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(resumeLog, 300); });

  // ---------- the 5-second call log ----------
  const DEFAULT_NEXT = { no_answer: 1, busy: 1, voicemail: 1, sent: 2, replied: 1, conversation: 3, callback: 1, stay_in_touch: 30, referral: 30 };
  C.logSheet = (lead, channel = "call") => {
    let outcome = null, nos = 0, nextIso = null, nextTouched = false;
    const callOutcomes = [["no_answer", "No answer"], ["busy", "Busy"], ["wrong_number", "Wrong number"]];
    const waOutcomes = [["sent", "Sent, no reply"], ["replied", "Replied"]];
    const reached = [["booked", "Booked meeting"], ["stay_in_touch", "Stay in touch"], ["referral", "Gave a referral"],
      ["callback", "Call back later"], ["conversation", "Spoke, no outcome"], ["not_interested", "Not interested at all"], ["dnc_request", "Don't contact me"]];
    const chan = C.seg([["call", "Call"], ["whatsapp", "WhatsApp"], ["email", "Email"]], channel, (v) => {
      channel = v; chan.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(["call", "whatsapp", "email"][i] === v))); paintOutcomes(); }, "wide");
    const outWrap = h("div");
    const nextLbl = h("p", { class: "fhint" });
    const nextDate = h("input", { type: "date" }), nextTime = h("input", { type: "time", value: "10:00", step: 300 });
    const setNext = (d, t) => { nextDate.value = d || ""; if (t) nextTime.value = t; nextIso = d ? C.fromGulf(d, nextTime.value || "10:00") : null; nextLbl.textContent = nextIso ? `Next touch: ${C.fmtWhen(nextIso)}` : "No follow-up"; };
    nextDate.addEventListener("input", () => { nextTouched = true; setNext(nextDate.value); });
    nextTime.addEventListener("input", () => { nextTouched = true; setNext(nextDate.value); });
    const nextBox = h("div", { class: "fld" }, h("label", null, "Follow up"),
      h("div", { class: "chips" }, C.quickDays().slice(1).map(([l, d, t]) => h("button", { type: "button", onclick: () => { nextTouched = true; setNext(d, t); } }, l)),
        h("button", { type: "button", onclick: () => { nextTouched = true; setNext(null); } }, "None")),
      h("div", { class: "dt" }, nextDate, nextTime), nextLbl);
    const nosRow = h("div", { class: "fld" }, h("label", null, "Nos before hanging up (leave after three)"),
      h("div", { class: "chips pick" }, [0, 1, 2, 3].map((n) => h("button", { type: "button", "aria-pressed": String(n === 0), onclick: (e) => { nos = n; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, String(n)))));
    const note = h("textarea", { rows: 2, placeholder: "What did they say? (need, timing, who decides)" });
    const lostReason = h("input", { type: "text", placeholder: "Why? (optional)" });
    const lostBox = h("div", { class: "fld", hidden: true }, h("label", null, "Reason"), lostReason);
    const nurtureReason = h("input", { type: "text", placeholder: "Real later reason: bonus in March, RSUs vesting…" });
    const nurtureBox = h("div", { class: "fld", hidden: true }, h("label", null, "Their reason for later"), nurtureReason);
    const pick = (v, btn) => {
      outcome = v;
      outWrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      const terminal = ["wrong_number", "not_interested", "dnc_request", "booked"].includes(v);
      nextBox.hidden = terminal; lostBox.hidden = v !== "not_interested"; nurtureBox.hidden = v !== "stay_in_touch";
      if (!nextTouched) {
        if (terminal) setNext(null);
        else { const n = DEFAULT_NEXT[v] ?? 2; setNext(C.addDays(C.gulfToday(), v === "no_answer" && (lead.touch_count || 0) >= 3 ? 3 : n), "10:00"); }
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
    const saveBtn = h("button", { class: "btn", type: "button", disabled: true, onclick: () => {
      if (!outcome) return;
      const body = { lead_id: lead.id, channel, outcome, nos, note: note.value.trim() || null,
        next_action_at: nextBox.hidden ? null : nextIso, next_action: nextBox.hidden || !nextIso ? null : (outcome === "callback" ? "Call back" : "Follow up"),
        lost_reason: lostReason.value.trim() || null, nurture_reason: nurtureReason.value.trim() || null };
      const done = outcome;
      close();   // never wait on the network between calls
      if (done === "booked") C.bookSheet(lead);
      else if (done === "referral") C.leadSheet({ source: "referral", referred_by: lead.id, source_detail: `Referred by ${lead.name}` });
      const send = () => C.api("touches", { method: "POST", body, queue: true }).then((res) => {
        if (res.queued) { C.toast("No signal: saved on the phone, will sync"); return; }
        C.toast(`${C.OUTCOME[done]} logged`, { label: "Undo", fn: async () => { await C.api(`touches/${res.touch.id}`, { method: "DELETE" }); C.toast("Removed"); C.refresh(); } });
        C.refresh();
      }).catch((e) => C.toast(`Not saved: ${e.message}`, { label: "Retry", fn: send }));
      send();
    } }, "Save");
    paintOutcomes();
    const close = C.sheet(`Log: ${lead.name}`, h("div", null,
      lead.phone ? h("p", { class: "fhint" }, `${lead.phone}${lead.touch_count ? ` · ${lead.touch_count} earlier touches` : ""}${lead.last_outcome ? ` · last: ${C.OUTCOME[lead.last_outcome] || lead.last_outcome}` : ""}`) : null,
      chan, outWrap, nurtureBox, lostBox, nosRow, nextBox, h("div", { class: "fld" }, h("label", null, "Note"), note)), [saveBtn], { noFocus: true });
  };

  // ---------- tasks ----------
  // A lead picker: type a name, pick from matches.
  C.leadPicker = (initial, onchange) => {
    let cur = initial || null;
    const input = h("input", { type: "search", placeholder: "Search a lead (optional)", value: cur ? cur.name : "", autocomplete: "off" });
    const list = h("div", { class: "picklist", hidden: true });
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      if (cur && input.value !== cur.name) { cur = null; onchange?.(null); }
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      t = setTimeout(async () => {
        const res = await C.api(`leads?q=${encodeURIComponent(q)}&limit=8`).catch(() => ({ leads: [] }));
        list.replaceChildren(...res.leads.map((l) => h("button", { type: "button", onclick: () => { cur = l; input.value = l.name; list.hidden = true; onchange?.(l); } },
          h("b", null, l.name), h("small", null, [l.phone, C.STATUS[l.status]].filter(Boolean).join(" · ")))));
        list.hidden = !res.leads.length;
      }, 200);
    });
    return { el: h("div", { class: "picker" }, input, list), get: () => cur };
  };
  C.taskSheet = ({ task = null, lead = null, title = "", kind = "follow_up", due = null } = {}) => {
    const t = task || { title, kind, due_at: due, lead_id: lead?.id, lead_name: lead?.name };
    const picker = C.leadPicker(t.lead_id ? { id: t.lead_id, name: t.lead_name || lead?.name } : null);
    const f = C.form([
      { k: "title", label: "Task", required: true, placeholder: "Call back about the Emaar South villa" },
      { type: "el", el: h("div", { class: "fld" }, h("label", null, "Lead"), picker.el) },
      { k: "due_at", label: "When", type: "datetime", defaultTime: "10:00", quick: C.quickDays() },
      { k: "kind", label: "Type", type: "chips", options: C.opts(C.TASK_KIND) },
      { k: "priority", label: "Important?", type: "chips", options: [["1", "Yes"], ["0", "No"]], num: true },
      { k: "notes", label: "Notes", type: "textarea", rows: 2 },
    ], { ...t, priority: t.priority || 0, title: t.title || "" });
    const save = h("button", { class: "btn", type: "button", onclick: async () => {
      const body = { ...f.get(), lead_id: picker.get()?.id || null };
      if (!body.title) return C.toast("Give the task a name");
      try {
        const r = task ? await C.api(`tasks/${task.id}`, { method: "PATCH", body, queue: true }) : await C.api("tasks", { method: "POST", body, queue: true });
        close(); C.toast(r.queued ? "Saved on the phone, will sync" : task ? "Task saved" : "Task added"); C.refresh();
      } catch (e) { C.fail(e); }
    } }, task ? "Save" : "Add task");
    const extra = task ? [
      h("button", { class: "btn ghost", type: "button", onclick: async () => { await C.api(`tasks/${task.id}`, { method: "PATCH", body: { done: !task.done_at } }); close(); C.refresh(); } }, task.done_at ? "Reopen" : "Done ✓"),
      h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!(await C.ask("Delete this task?", { ok: "Delete", danger: true }))) return; await C.api(`tasks/${task.id}`, { method: "DELETE" }); close(); C.refresh(); } }, "Delete"),
    ] : [];
    const close = C.sheet(task ? "Task" : "New task", f.el, [save, ...extra]);
  };
  C.followUpSheet = (lead) => C.taskSheet({ lead, title: "Follow up" });

  // ---------- lead form ----------
  C.leadSheet = (lead = {}, onSaved) => {
    const editing = !!lead.id;
    const main = C.form([
      { k: "name", label: "Name", required: true, autocomplete: "name" },
      { k: "phone", label: "Phone", type: "tel", placeholder: "+971 50… / +91… / +1…", half: true },
      { k: "whatsapp", label: "WhatsApp (if different)", type: "tel", half: true },
      { k: "country", label: "Country", type: "select", options: C.opts(C.COUNTRY), half: true, hint: "Filled from the number if left blank" },
      { k: "city", label: "City", half: true },
      { k: "icp", label: "Buyer type", type: "chips", options: C.opts(C.ICP) },
      { k: "source", label: "Source", type: "chips", options: C.opts(C.SOURCE) },
      { k: "source_detail", label: "Source detail", placeholder: "Which list, post, launch campaign or portal" },
      editing ? null : { k: "inbound", label: "New enquiry right now?", type: "chips", options: [["0", "No"], ["1", "Yes: they just contacted me"]], num: true, required: true,
        hint: "Yes starts the 5-minute timer. Old leads, Lyka CRM records and lists you call are No." },
      { k: "temperature", label: "Temperature", type: "chips", options: C.opts(C.TEMP) },
      editing ? null : { k: "next_action_at", label: "First follow-up", type: "datetime", defaultTime: "10:00", quick: C.quickDays() },
      { k: "email", label: "Email", type: "email", half: true },
      { k: "job_title", label: "Job title", half: true },
      { k: "company", label: "Company", half: true },
      { k: "tags", label: "Tags", half: true, placeholder: "H-1B, Tamil, Golden Visa" },
      { k: "notes", label: "Notes", type: "textarea" },
    ], { icp: "nri", source: "other", temperature: "warm", inbound: 0, ...lead });
    const extra = editing ? C.form([
      { type: "heading", label: "Qualification" },
      { k: "inbound", label: "Fresh inbound enquiry (5-minute rule)", type: "chips", options: [["1", "Yes"], ["0", "No"]], num: true, required: true,
        hint: "No removes the 5-minute timer and its task." },
      { k: "status", label: "Stage", type: "select", options: C.opts(C.STATUS), half: true },
      { k: "dncr", label: "DNCR (UAE numbers)", type: "select", options: [["unknown", "Not checked"], ["clear", "Checked: clear"], ["listed", "On the registry"]], half: true },
      { k: "lane", label: "Lane", type: "chips", options: C.opts(C.LANE) },
      { k: "need", label: "Real goal", type: "chips", options: C.opts(C.NEED) },
      { k: "budget_min", label: "Budget from (AED)", type: "money", half: true },
      { k: "budget_max", label: "Budget to (AED)", type: "money", half: true },
      { k: "funding", label: "Funding", type: "chips", options: [["cash", "Cash"], ["mortgage", "Mortgage"], ["mixed", "Mixed"]] },
      { k: "decision_makers", label: "Who decides", placeholder: "Wife, parents, business partner" },
      { k: "timeline", label: "Timeline", placeholder: "This launch / Q1 / after bonus" },
      { k: "nurture_reason", label: "Nurture reason", half: true },
      { k: "lost_reason", label: "Lost reason", half: true },
    ], lead) : null;
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const body = { ...main.get(), ...(extra ? extra.get() : {}) };
      if (!body.name) return C.toast("Name is required");
      if (lead.referred_by && !editing) body.referred_by = lead.referred_by;
      if (body.next_action_at) body.next_action = "Follow up";
      if (body.inbound) body.temperature = body.temperature || "hot";
      saveBtn.disabled = true;
      try {
        const res = editing ? await C.api(`leads/${lead.id}`, { method: "PATCH", body }) : await C.api("leads", { method: "POST", body });
        close();
        C.toast(editing ? "Saved" : "Lead added");
        if (onSaved) onSaved(res.lead); else if (!editing) location.hash = `lead/${res.lead.id}`; else C.refresh();
      } catch (e) {
        saveBtn.disabled = false;
        if (e.status === 409 && e.data?.duplicate) C.toast(e.message, { label: "Open", fn: () => { close(); location.hash = `lead/${e.data.duplicate.id}`; } });
        else C.fail(e);
      }
    } }, editing ? "Save" : "Add lead");
    const close = C.sheet(editing ? `Edit ${lead.name}` : lead.referred_by ? "Add the referral" : "New lead", h("div", null, main.el, extra ? extra.el : null), [saveBtn]);
  };

  // ---------- household / decision-makers ----------
  C.personSheet = (leadId, person = null) => {
    const f = C.form([
      { k: "name", label: "Name", required: true },
      { k: "relation", label: "Relation", type: "chips", options: C.opts(C.RELATION) },
      { k: "decision_maker", label: "Has to say yes?", type: "chips", options: [["1", "Yes, decision-maker"], ["0", "Influences it"]], num: true },
      { k: "phone", label: "Phone", type: "tel", half: true }, { k: "email", label: "Email", type: "email", half: true },
      { k: "notes", label: "Notes", type: "textarea", rows: 2, placeholder: "What matters to them (school, rental income, safety…)" },
    ], person || { decision_maker: 1, relation: "spouse" });
    const close = C.sheet(person ? person.name : "Add a person", f.el, [
      h("button", { class: "btn", type: "button", onclick: async () => {
        const b = f.get(); if (!b.name) return C.toast("Name is required");
        try { person ? await C.api(`people/${person.id}`, { method: "PATCH", body: b }) : await C.api("people", { method: "POST", body: { ...b, lead_id: leadId } }); close(); C.refresh(); } catch (e) { C.fail(e); }
      } }, "Save"),
      person ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => { await C.api(`people/${person.id}`, { method: "DELETE" }); close(); C.refresh(); } }, "Remove") : null]);
  };

  // ---------- meetings ----------
  C.slotQuick = () => {
    const t = C.gulfToday();
    const d2 = C.addDays(t, 2);
    return [["Tomorrow 11:00", C.addDays(t, 1), "11:00"], ["Tomorrow 19:00", C.addDays(t, 1), "19:00"], [`${C.fmtDay(C.fromGulf(d2))} 11:00`, d2, "11:00"], [`${C.fmtDay(C.fromGulf(d2))} 14:00`, d2, "14:00"]];
  };
  C.bookSheet = (lead, meeting = null) => {
    const f = C.form([
      { type: "note", label: "Offer two slots, never “when are you free?”. Don't hang up until the invite is on their calendar." },
      { k: "scheduled_at", label: "When (Gulf time)", type: "datetime", defaultTime: "11:00", quick: C.slotQuick() },
      { k: "kind", label: "Type", type: "chips", options: C.opts(C.MEET_KIND), required: true },
      { k: "decision_maker_joining", label: "Is the decision-maker joining?", type: "chips", options: [["1", "Yes"], ["0", "No: book them in"]], num: true, hint: "B2C: no decision-maker on the call, no call." },
      { k: "attendees", label: "Who's joining", placeholder: "Ravi + wife Priya" },
      { k: "notes", label: "Notes for the call", type: "textarea", placeholder: "What they told you on the cold call" },
    ], meeting || { kind: "video" });
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      const body = f.get();
      if (!body.scheduled_at) return C.toast("Pick a date and time");
      saveBtn.disabled = true;
      try {
        const res = meeting ? await C.api(`meetings/${meeting.id}`, { method: "PATCH", body: { ...body, status: "booked" } }) : await C.api("meetings", { method: "POST", body: { ...body, lead_id: lead.id } });
        close(); afterBooking(lead, res.meeting); C.refresh();
      } catch (e) { saveBtn.disabled = false; C.fail(e); }
    } }, meeting ? "Reschedule" : "Book meeting");
    const close = C.sheet(meeting ? `Reschedule: ${lead.name}` : `Book: ${lead.name}`, f.el, [saveBtn]);
  };
  function icsFor(lead, m) {
    const stamp = (iso) => iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sanjay Ram CRM//EN", "BEGIN:VEVENT", `UID:crm-meeting-${m.id}@sanjay-crm`,
      `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(m.scheduled_at)}`, "DURATION:PT30M",
      `SUMMARY:${(C.MEET_KIND[m.kind] || "Meeting")}: ${lead.name} · Dubai off-plan shortlist`.replace(/[,;]/g, " "),
      `DESCRIPTION:Sanjay (Lyka Realty) · ${lead.phone || ""}`.replace(/[,;]/g, " "),
      "BEGIN:VALARM", "TRIGGER:-PT60M", "ACTION:DISPLAY", "DESCRIPTION:Send the WhatsApp reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"];
    return new Blob([lines.join("\r\n")], { type: "text/calendar" });
  }
  C.downloadIcs = (lead, m) => {
    const a = h("a", { href: URL.createObjectURL(icsFor(lead, m)), download: `meeting-${C.first(lead.name)}.ics` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  function afterBooking(lead, m) {
    const close = C.sheet("Meeting booked ✓", h("div", null,
      h("p", null, h("b", null, C.fmtWhen(m.scheduled_at)), ` · ${C.MEET_KIND[m.kind] || m.kind}`),
      h("p", { class: "fhint" }, "Before you hang up: calendar invite accepted, WhatsApp saved, reminder the morning of the call."),
      h("div", { class: "stack" },
        h("button", { class: "btn", type: "button", onclick: () => C.downloadIcs(lead, m) }, "Add to calendar (.ics)"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { close(); C.startWhatsApp(lead, { time: C.fmtTime(m.scheduled_at), day: C.fmtDay(m.scheduled_at) }); } }, "WhatsApp confirmation"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { close(); location.hash = `meeting/${m.id}`; } }, "Open meeting prep"))), null, { noFocus: true });
  }

  // ---------- deals ----------
  C.dealSheet = async (lead, deal = null, meetingId = null) => {
    const inv = (await C.get("inventory").catch(() => ({ inventory: [] }))).inventory.filter((i) => i.status === "active");
    const s = C.settings;
    const d = deal || { stage: "eoi", commission_pct: s.commission_pct, split_pct: s.split_pct, lane: lead.lane, eoi_refundable: 1 };
    let commTouched = !!deal;
    const netEl = h("p", { class: "netcalc" });
    let f;
    const paintNet = () => { const v = f.get(); const n = C.netOf(v); netEl.replaceChildren("Your net: ", h("b", null, C.both(n)), v.price_aed ? ` · ${v.commission_pct || 0}% × ${v.split_pct || 0}% of ${C.aed(v.price_aed)}` : ""); };
    const autoComm = (pct) => { const inp = f?.input("commission_pct"); if (commTouched || !inp) return; inp.value = pct ?? s.commission_pct; paintNet(); };
    f = C.form([
      inv.length ? { k: "inventory_id", label: "From your Launch Filter", type: "select", num: true, placeholder: "Pick a project (optional)",
        options: inv.map((i) => [i.id, `${i.project}${i.developer ? ` · ${i.developer}` : ""}`]), onchange: (id) => {
          const i = inv.find((x) => x.id === id); if (!i) return;
          for (const [k, v] of [["project", i.project], ["developer", i.developer], ["lane", i.lane], ["price_aed", i.price_from_aed]]) { const el = f.input(k); if (el && !el.value && v != null) el.value = v; }
          autoComm(i.commission_pct ?? C.devPct(i.developer)); paintNet();
        } } : null,
      { k: "project", label: "Project", half: true }, { k: "developer", label: "Developer", half: true, oninput: (v) => autoComm(C.devPct(v)) },
      { k: "unit", label: "Unit", half: true, placeholder: "V-214, 4BR" },
      { k: "lane", label: "Lane", type: "select", options: C.opts(C.LANE), half: true },
      { k: "price_aed", label: "Price (AED)", type: "money", oninput: () => paintNet() },
      { k: "commission_pct", label: "Agency commission %", type: "number", half: true, step: "0.1", oninput: () => { commTouched = true; paintNet(); }, hint: "Set by the developer (5–8%)" },
      { k: "split_pct", label: "Your split %", type: "number", half: true, step: "1", oninput: () => paintNet(), hint: "Lyka's split" },
      { k: "stage", label: "Stage", type: "chips", options: [...C.STAGES, ["fell_through", "Fell through"]], required: true },
      { k: "eoi_amount", label: "EOI / booking deposit (AED)", type: "money", half: true },
      { k: "eoi_refundable", label: "EOI refundable?", type: "chips", options: [["1", "Yes"], ["0", "No"]], num: true, half: true },
      { type: "heading", label: "Dates", hint: "Filled in automatically when you move the stage." },
      { k: "eoi_at", label: "EOI", type: "date", iso: true, half: true }, { k: "allocation_at", label: "Allocation", type: "date", iso: true, half: true },
      { k: "booking_at", label: "Booking (counts as closed)", type: "date", iso: true, half: true }, { k: "spa_at", label: "SPA signed", type: "date", iso: true, half: true },
      { k: "oqood_at", label: "Oqood registered", type: "date", iso: true, half: true },
      { k: "commission_expected_at", label: "Commission expected", type: "date", iso: true, half: true, hint: "Usually after the first instalment + registration (1–3 months)" },
      { k: "commission_paid_at", label: "Commission paid", type: "date", iso: true, half: true },
      { k: "commission_paid_aed", label: "Amount you received (AED)", type: "money", half: true },
      { k: "fell_through_reason", label: "If it fell through: why" },
      { k: "notes", label: "Notes", type: "textarea" },
    ], d);
    paintNet();
    const saveBtn = h("button", { class: "btn", type: "button", onclick: async () => {
      saveBtn.disabled = true;
      try {
        const body = f.get();
        if (deal) await C.api(`deals/${deal.id}`, { method: "PATCH", body });
        else await C.api("deals", { method: "POST", body: { ...body, lead_id: lead.id, meeting_id: meetingId } });
        close(); C.toast(deal ? "Deal saved" : "Deal added: EOI 🎉"); C.refresh();
      } catch (e) { saveBtn.disabled = false; C.fail(e); }
    } }, deal ? "Save deal" : "Add deal");
    const close = C.sheet(deal ? `${lead.name}: ${deal.project || "deal"}` : `New deal: ${lead.name}`, h("div", null, netEl,
      deal ? h("button", { class: "btn ghost full", type: "button", onclick: () => { close(); C.planSheet(deal.id); } }, C.icon("money", 18), "Client payment plan") : null, f.el), [saveBtn,
      deal ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => { if (!(await C.ask("Delete this deal?", { ok: "Delete", danger: true }))) return; await C.api(`deals/${deal.id}`, { method: "DELETE" }); close(); C.toast("Deal deleted"); C.refresh(); } }, "Delete") : null], { wide: true });
  };
  C.advanceDeal = async (deal) => {
    const order = C.STAGES.map((x) => x[0]);
    const nxt = order[order.indexOf(deal.stage) + 1];
    if (!nxt) return;
    try { await C.api(`deals/${deal.id}`, { method: "PATCH", body: { stage: nxt } }); C.toast(`Moved to ${C.STAGE[nxt]}`); C.refresh(); } catch (e) { C.fail(e); }
  };

  // ---------- client payment plan ----------
  const PRESETS = [["10 / 90", [10, 90]], ["20 / 80", [20, 80]], ["10 / 10 / 40 / 40", [10, 10, 40, 40]], ["30 / 70", [30, 70]], ["60 / 40", [60, 40]]];
  C.planSheet = async (dealId) => {
    const { deal, installments } = await C.api(`deals/${dealId}`);
    const paid = installments.filter((i) => i.paid_at);
    const rowsEl = h("div", { class: "plan" });
    const totalEl = h("p", { class: "fhint" });
    const rows = [];
    const paint = () => {
      const pct = [...paid, ...rows.map((r) => ({ pct: Number(r.pct.value) || 0 }))].reduce((t, x) => t + (Number(x.pct) || 0), 0);
      totalEl.textContent = `${pct}% of ${C.aed(deal.price_aed)} scheduled${pct === 100 ? " ✓" : pct > 100 ? " (over 100%)" : ""}`;
    };
    const addRow = (r = {}) => {
      const row = { label: h("input", { type: "text", value: r.label || "", placeholder: "Booking / 3 months / handover" }),
        date: h("input", { type: "date", value: r.due_date || "" }), pct: h("input", { type: "number", value: r.pct ?? "", inputmode: "decimal", placeholder: "%", class: "tiny" }) };
      row.pct.addEventListener("input", paint);
      row.el = h("div", { class: "prow" }, row.label, row.date, row.pct, h("button", { class: "x", type: "button", "aria-label": "Remove", onclick: () => { rows.splice(rows.indexOf(row), 1); row.el.remove(); paint(); } }, C.icon("x", 16)));
      rows.push(row); rowsEl.append(row.el); paint();
    };
    installments.filter((i) => !i.paid_at).forEach(addRow);
    if (!rows.length && !paid.length) addRow({ label: "Booking", due_date: deal.booking_at ? C.gulf(deal.booking_at).slice(0, 10) : C.gulfToday() });
    const presets = h("div", { class: "chips" }, PRESETS.map(([l, parts]) => h("button", { type: "button", onclick: () => {
      rows.splice(0).forEach((r) => r.el.remove());
      const start = deal.booking_at ? C.gulf(deal.booking_at).slice(0, 10) : C.gulfToday();
      parts.forEach((p, i) => addRow({ label: i === 0 ? "Booking" : i === parts.length - 1 ? "Handover" : `Instalment ${i}`, pct: p, due_date: i === 0 ? start : "" }));
    } }, l)));
    const paidEl = paid.length ? h("div", null, h("h3", { class: "fh" }, "Paid"), paid.map((i) => h("div", { class: "wrow" },
      h("div", null, h("b", null, i.label || "Payment"), h("small", null, `${i.due_date ? C.fmtDay(i.due_date) : ""} · paid ${C.fmtDay(i.paid_at)}`)),
      h("div", { class: "r" }, h("div", null, C.aed(i.amount_aed)), h("button", { class: "linkbtn", type: "button", onclick: async () => { await C.api(`installments/${i.id}`, { method: "PATCH", body: { paid: false } }); close(); C.planSheet(dealId); } }, "Undo"))))) : null;
    const dueEl = installments.filter((i) => !i.paid_at && i.id).length ? h("div", null, h("h3", { class: "fh" }, "Mark as paid"), installments.filter((i) => !i.paid_at).map((i) => h("div", { class: "wrow" },
      h("div", null, h("b", null, i.label || "Payment"), h("small", null, `${i.due_date ? C.fmtDay(i.due_date) : "no date"} · ${i.pct ?? "–"}%`)),
      h("div", { class: "r" }, h("div", null, C.aed(i.amount_aed)), h("button", { class: "linkbtn", type: "button", onclick: async () => { await C.api(`installments/${i.id}`, { method: "PATCH", body: { paid: true } }); C.toast("Marked paid"); close(); C.planSheet(dealId); } }, "Paid ✓"))))) : null;
    const close = C.sheet(`Payment plan: ${deal.name}`, h("div", null,
      h("p", { class: "fhint" }, `${deal.project || "Deal"}${deal.unit ? ` · ${deal.unit}` : ""} · ${C.aed(deal.price_aed)}. Remind the client before each payment; commission usually follows the first instalment and registration.`),
      dueEl, paidEl, h("h3", { class: "fh" }, "Schedule"), presets, rowsEl, totalEl,
      h("button", { class: "btn ghost", type: "button", onclick: () => addRow() }, C.icon("plus", 16), "Add payment")), [
      h("button", { class: "btn", type: "button", onclick: async () => {
        const body = { rows: rows.map((r) => ({ label: r.label.value.trim() || null, due_date: r.date.value || null, pct: r.pct.value === "" ? null : Number(r.pct.value) })) };
        try { await C.api(`deals/${dealId}/plan`, { method: "PUT", body }); close(); C.toast("Payment plan saved"); C.refresh(); } catch (e) { C.fail(e); }
      } }, "Save plan")], { wide: true });
  };
})();
