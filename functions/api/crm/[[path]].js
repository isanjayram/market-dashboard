// CRM API (Cloudflare Pages Function + D1 database bound as CRM).
// The password gate in functions/_middleware.js protects every route except two that carry their own key:
//   POST /api/crm/inbound?key=…   new lead from a form, portal or Zapier (pings Telegram: call within 5 minutes)
//   POST /api/crm/digest?kind=…   morning agenda / Friday review on Telegram, called by .github/workflows/crm.yml
// Times are stored as UTC ISO strings and bucketed in Gulf time (UTC+4, no daylight saving).

import { notifyAll, vapidKeys } from "../../../lib/crm/push.js";

const GST = 4 * 3600e3;
const enc = new TextEncoder();
const AED_PER_USD = 3.6725;

const DEFAULTS = {
  goal_usd: 100000,
  net_per_deal_usd: 13000,
  deals_target: 8,
  deals_buffer: 10,
  start_date: "2026-11-02",
  deadline: "2027-03-31",
  daily_touches: 60,
  weekly: { touches: 300, conversations: 90, booked: 4, held: 3, eoi: 1 },
  rates: { pickup: 0.30, book: 0.04, show: 0.75, close: 0.15 },
  monthly: [
    { month: "2026-11", focus: "Build pipeline: 60 dials/day, offer locked, content daily", low: 0, high: 1 },
    { month: "2026-12", focus: "Meetings flowing, first EOIs", low: 1, high: 2 },
    { month: "2027-01", focus: "Full engine + nurture leads converting", low: 2, high: 3 },
    { month: "2027-02", focus: "Peak closing", low: 2, high: 3 },
    { month: "2027-03", focus: "Close remaining pipeline", low: 2, high: 2 },
  ],
  commission_pct: 5,                // used only when the developer isn't in the list below
  split_pct: 50,                    // Lyka's split: constant
  developer_commissions: [],
  smart_lists: [                    // saved filters on the Leads screen (a query string each)
    { name: "Hot, not touched 3 days", query: "temperature=hot&view=open&untouched=3" },
    { name: "NRIs in the US", query: "country=US&view=open" },
    { name: "Overdue follow-ups", query: "task=overdue&view=open" },
  ],        // [{ developer: "Emaar", pct: 5 }, …]: agency commission per developer
  calling_hours: [9, 18],
  templates: [
    { name: "Meeting reminder", text: "Hi {first}, it's Sanjay from Lyka Realty. Quick reminder of our call today at {time}. I've shortlisted 3 options that fit what you told me. Speak soon!" },
    { name: "Stay in touch", text: "Hi {first}, Sanjay from Lyka Realty here. As promised, I'll only send you launches that pass my Launch Filter (developer delivery record, location growth driver, payment-plan fit). Speak soon." },
    { name: "Missed call", text: "Hi {first}, it's Sanjay from Lyka Realty. I tried calling you about off-plan property in Dubai. When's a good time for a 2-minute call?" },
    { name: "After the call", text: "Hi {first}, great speaking with you. As discussed, here's the payment plan for the unit. Any questions, message me here." },
  ],
};

const LEAD_FIELDS = ["name", "phone", "whatsapp", "email", "country", "city", "icp", "job_title", "company", "source",
  "source_detail", "referred_by", "inbound", "inbound_at", "status", "temperature", "lane", "need", "budget_min", "budget_max",
  "funding", "decision_makers", "timeline", "next_action", "next_action_at", "dncr", "lost_reason", "nurture_reason", "tags", "notes"];
const MEETING_FIELDS = ["scheduled_at", "kind", "status", "decision_maker_joining", "attendees",
  "g1_goal", "g1_why", "g1_tried", "g1_realign", "g1_pass", "g2_decision", "g2_dm_present", "g2_timeline", "g2_reason", "g2_pass",
  "g3_budget_min", "g3_budget_max", "g3_down_payment", "g3_funding", "g3_access", "g3_pass", "lane", "belief_break", "units_shown",
  "close_score", "why_not_lower", "to_ten", "objections", "outcome", "next_call_at", "notes"];
const DEAL_FIELDS = ["meeting_id", "inventory_id", "project", "developer", "unit", "lane", "price_aed", "commission_pct", "split_pct",
  "stage", "eoi_at", "eoi_amount", "eoi_refundable", "allocation_at", "booking_at", "spa_at", "oqood_at", "commission_expected_at",
  "commission_paid_at", "commission_paid_aed", "fell_through_at", "fell_through_reason", "notes"];
const INVENTORY_FIELDS = ["project", "developer", "area", "lane", "unit_types", "price_from_aed", "down_payment_pct", "commission_pct", "payment_plan",
  "handover", "f_delivery", "f_growth", "f_payment", "filter_notes", "eoi_deadline", "link", "status"];
const NUMERIC = new Set(["referred_by", "inbound", "budget_min", "budget_max", "decision_maker_joining", "g1_pass", "g2_dm_present",
  "g2_pass", "g3_budget_min", "g3_budget_max", "g3_down_payment", "g3_pass", "close_score", "meeting_id", "inventory_id", "price_aed",
  "commission_pct", "split_pct", "eoi_amount", "eoi_refundable", "commission_paid_aed", "price_from_aed", "down_payment_pct",
  "f_delivery", "f_growth", "f_payment", "nos"]);

const STATUS_RANK = { new: 0, attempting: 1, conversation: 2, meeting_booked: 3, meeting_held: 4, qualified: 5, eoi: 6, won: 7 };
const REACHED = ["conversation", "callback", "booked", "stay_in_touch", "referral", "not_interested", "dnc_request", "replied"];
const REACHED_SQL = REACHED.map((o) => `'${o}'`).join(",");
const DEAL_STAGES = ["eoi", "allocation", "booking", "spa", "oqood", "paid"];
const STAGE_DATE = { eoi: "eoi_at", allocation: "allocation_at", booking: "booking_at", spa: "spa_at", oqood: "oqood_at",
  paid: "commission_paid_at", fell_through: "fell_through_at" };
const CLOSED_STAGES = ["booking", "spa", "oqood", "paid"];
const OPEN = "status NOT IN ('lost','dnc')";

// ---------- small helpers ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const nowIso = () => new Date().toISOString();
const gulfDate = (d = new Date()) => new Date(d.getTime() + GST).toISOString().slice(0, 10);
const dayStart = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - GST).toISOString();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const netAed = (d) => (d.price_aed || 0) * (d.commission_pct || 0) / 100 * (d.split_pct || 0) / 100;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameString(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Phone numbers: keep one shape (+<country><number>) so duplicates are caught and wa.me links work.
function normPhone(raw, country) {
  if (!raw) return null;
  let p = String(raw).trim().replace(/[^\d+]/g, "");
  if (!p) return null;
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (p.startsWith("+")) return p;
  if (/^05\d{8}$/.test(p)) return "+971" + p.slice(1);            // UAE mobile 05x xxx xxxx
  if (/^5\d{8}$/.test(p)) return "+971" + p;
  if (/^971\d{8,9}$/.test(p)) return "+" + p;
  if (/^91[6-9]\d{9}$/.test(p)) return "+" + p;
  if (/^0?[6-9]\d{9}$/.test(p) && country !== "US") return "+91" + p.replace(/^0/, ""); // Indian mobile
  if (/^1\d{10}$/.test(p)) return "+" + p;
  if (/^\d{10}$/.test(p) && country === "US") return "+1" + p;
  return p;
}
function countryOf(phone) {
  if (!phone) return null;
  if (phone.startsWith("+971")) return "AE";
  if (phone.startsWith("+91")) return "IN";
  if (phone.startsWith("+1")) return "US";
  if (phone.startsWith("+44")) return "UK";
  if (phone.startsWith("+966")) return "SA";
  if (phone.startsWith("+974")) return "QA";
  return null;
}

function clean(body, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f in body)) continue;
    let v = body[f];
    if (v === "" || v === undefined) v = null;
    if (v !== null && NUMERIC.has(f)) { v = Number(v); if (!Number.isFinite(v)) v = null; }
    if (v !== null && typeof v === "boolean") v = v ? 1 : 0;
    if (v !== null && (f.endsWith("_at")) && typeof v === "string") {
      const t = Date.parse(v);
      v = Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    if (v !== null && f === "objections" && typeof v !== "string") v = JSON.stringify(v);
    if (typeof v === "string") v = v.trim().slice(0, 4000);
    out[f] = v;
  }
  return out;
}

async function insert(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING *`;
  return db.prepare(sql).bind(...keys.map((k) => row[k])).first();
}
async function update(db, table, id, row, touch = true) {
  const keys = Object.keys(row);
  if (!keys.length) return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  const sets = keys.map((k) => `${k} = ?`);
  if (touch) sets.push("updated_at = ?");
  const vals = keys.map((k) => row[k]);
  if (touch) vals.push(nowIso());
  return db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ? RETURNING *`).bind(...vals, id).first();
}

// Settings change rarely: keep them in memory for a minute instead of reading them on every request.
let settingsCache = null, settingsAt = 0;
async function getSettings(db, fresh = false) {
  if (!fresh && settingsCache && Date.now() - settingsAt < 60e3) return structuredClone(settingsCache);
  const rows = (await db.prepare("SELECT key, value FROM settings").all()).results;
  const s = structuredClone(DEFAULTS);
  for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch (e) { /* keep default */ } }
  settingsCache = s; settingsAt = Date.now();
  return structuredClone(s);
}

// Move a lead forward along the funnel; never backwards (a no-show doesn't undo a booked meeting).
function nextStatus(current, status) {
  if (status === "lost" || status === "dnc") return status;
  if ((STATUS_RANK[status] ?? -1) > (STATUS_RANK[current] ?? -1) || current === "lost") return status;
  return null;
}
async function advance(db, leadId, status, extra = {}) {
  const lead = await db.prepare("SELECT status FROM leads WHERE id = ?").bind(leadId).first();
  if (!lead) return;
  const row = { ...extra };
  const st = nextStatus(lead.status, status);
  if (st) row.status = st;
  if (Object.keys(row).length) await update(db, "leads", leadId, row);
}

const LEAD_LIST_SQL = `SELECT l.*,
  (SELECT COUNT(*) FROM touches t WHERE t.lead_id = l.id) AS touch_count,
  (SELECT MAX(at) FROM touches t WHERE t.lead_id = l.id) AS last_touch_at,
  (SELECT outcome FROM touches t WHERE t.lead_id = l.id ORDER BY at DESC LIMIT 1) AS last_outcome,
  (SELECT MAX(at) FROM touches t WHERE t.lead_id = l.id AND t.outcome IN ('not_interested','dnc_request')) AS last_no_at
  FROM leads l`;

// ---------- routes ----------
async function today(db) {
  const s = await getSettings(db);
  const d = gulfDate();
  const start = dayStart(d), end = dayStart(addDays(d, 1));
  const weekStart = dayStart(mondayOf(d));
  const q = (sql, ...b) => db.prepare(sql).bind(...b);
  const [counts, week, inbound, meetings, overdue, due, hot, fresh, mine, payments] = await db.batch([
    q(`SELECT COUNT(*) AS touches, SUM(outcome IN (${REACHED_SQL})) AS conversations FROM touches WHERE direction='out' AND at >= ? AND at < ?`, start, end),
    q(`SELECT COUNT(*) AS touches, SUM(outcome IN (${REACHED_SQL})) AS conversations,
        (SELECT COUNT(*) FROM meetings WHERE booked_at >= ?1) AS booked,
        (SELECT COUNT(*) FROM meetings WHERE status='held' AND scheduled_at >= ?1) AS held,
        (SELECT COUNT(*) FROM deals WHERE eoi_at >= ?1) AS eoi
        FROM touches WHERE direction='out' AND at >= ?1`, weekStart),
    q(`${LEAD_LIST_SQL} WHERE l.inbound = 1 AND l.first_contact_at IS NULL AND l.${OPEN} ORDER BY l.inbound_at`),
    q(`SELECT m.*, l.name, l.phone, l.whatsapp, l.country FROM meetings m JOIN leads l ON l.id = m.lead_id
        WHERE m.scheduled_at >= ? AND m.scheduled_at < ? AND m.status IN ('booked','held') ORDER BY m.scheduled_at`, start, end),
    q(`${LEAD_LIST_SQL} WHERE l.next_action_at < ? AND l.${OPEN} AND NOT (l.inbound = 1 AND l.first_contact_at IS NULL)
        ORDER BY l.temperature = 'hot' DESC, l.next_action_at LIMIT 60`, start),
    q(`${LEAD_LIST_SQL} WHERE l.next_action_at >= ? AND l.next_action_at < ? AND l.${OPEN} AND NOT (l.inbound = 1 AND l.first_contact_at IS NULL)
        ORDER BY l.next_action_at LIMIT 60`, start, end),
    q(`${LEAD_LIST_SQL} WHERE l.temperature = 'hot' AND l.${OPEN} AND (l.next_action_at IS NULL OR l.next_action_at >= ?)
        AND NOT EXISTS (SELECT 1 FROM touches t WHERE t.lead_id = l.id AND t.at >= ?) ORDER BY l.updated_at DESC LIMIT 20`,
      end, dayStart(addDays(d, -6))),
    q(`${LEAD_LIST_SQL} WHERE l.status = 'new' AND l.inbound = 0 AND l.next_action_at IS NULL ORDER BY l.created_at LIMIT 40`),
    q(`${TASK_SQL} WHERE t.lead_id IS NULL AND t.done_at IS NULL AND (t.due_at IS NULL OR t.due_at < ?) ORDER BY t.due_at IS NULL, t.due_at LIMIT 30`, end),
    q(`SELECT i.*, d.project, d.unit, d.lead_id, l.name, l.phone, l.whatsapp FROM installments i JOIN deals d ON d.id = i.deal_id JOIN leads l ON l.id = d.lead_id
        WHERE i.paid_at IS NULL AND i.due_date <= ? ORDER BY i.due_date LIMIT 20`, addDays(d, 7)),
  ]);
  return {
    date: d, now: nowIso(), settings: s,
    counts: counts.results[0], week: week.results[0],
    inbound: inbound.results, meetings: meetings.results, overdue: overdue.results, due: due.results,
    hot: hot.results.filter((l) => !due.results.some((x) => x.id === l.id)), fresh: fresh.results,
    tasks: mine.results, payments: payments.results,
  };
}

async function listLeads(db, url) {
  const p = url.searchParams;
  const where = [], bind = [];
  if (p.get("q")) {
    const like = `%${p.get("q").trim()}%`;
    const digits = p.get("q").replace(/\D/g, "");
    where.push(`(l.name LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR l.notes LIKE ?${digits.length >= 4 ? " OR l.phone LIKE ?" : ""})`);
    bind.push(like, like, like, like);
    if (digits.length >= 4) bind.push(`%${digits}%`);
  }
  for (const f of ["status", "temperature", "source", "lane", "icp", "country"]) {
    if (p.get(f)) { where.push(`l.${f} = ?`); bind.push(p.get(f)); }
  }
  if (p.get("view") === "open") where.push(`l.${OPEN}`);
  if (p.get("tag")) { where.push("(', ' || lower(l.tags) || ',') LIKE ?"); bind.push(`%, ${p.get("tag").trim().toLowerCase()},%`); }
  if (Number(p.get("untouched")) > 0) {
    where.push("COALESCE((SELECT MAX(at) FROM touches t WHERE t.lead_id = l.id), l.created_at) < ?");
    bind.push(new Date(Date.now() - Number(p.get("untouched")) * 864e5).toISOString());
  }
  if (p.get("task") === "none") where.push("NOT EXISTS (SELECT 1 FROM tasks k WHERE k.lead_id = l.id AND k.done_at IS NULL)");
  if (p.get("task") === "open") where.push("EXISTS (SELECT 1 FROM tasks k WHERE k.lead_id = l.id AND k.done_at IS NULL)");
  if (p.get("task") === "overdue") { where.push("l.next_action_at < ?"); bind.push(dayStart(gulfDate())); }
  if (p.get("inbound")) { where.push("l.inbound = ?"); bind.push(Number(p.get("inbound"))); }
  if (p.get("created_from")) { where.push("l.created_at >= ?"); bind.push(dayStart(p.get("created_from"))); }
  if (p.get("view") === "pipeline") where.push(`l.status IN ('meeting_booked','meeting_held','qualified','eoi')`);
  const sort = { next: "l.next_action_at IS NULL, l.next_action_at", created: "l.created_at DESC", name: "l.name COLLATE NOCASE" }[p.get("sort")]
    || "COALESCE((SELECT MAX(at) FROM touches t WHERE t.lead_id = l.id), l.updated_at) DESC";
  const limit = Math.min(Number(p.get("limit")) || 100, 500), offset = Number(p.get("offset")) || 0;
  const sql = `${LEAD_LIST_SQL}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`;
  const rows = (await db.prepare(sql).bind(...bind).all()).results;
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM leads l${where.length ? " WHERE " + where.join(" AND ") : ""}`).bind(...bind).first()).n;
  return { leads: rows, total };
}

async function leadDetail(db, id) {
  const [leadRes, touches, meetings, deals, referrals, referrer, people, tasks, activity] = await db.batch([
    db.prepare(`${LEAD_LIST_SQL} WHERE l.id = ?`).bind(id),
    db.prepare("SELECT * FROM touches WHERE lead_id = ? ORDER BY at DESC").bind(id),
    db.prepare("SELECT * FROM meetings WHERE lead_id = ? ORDER BY scheduled_at DESC").bind(id),
    db.prepare("SELECT * FROM deals WHERE lead_id = ? ORDER BY created_at DESC").bind(id),
    db.prepare("SELECT id, name, status FROM leads WHERE referred_by = ?").bind(id),
    db.prepare("SELECT id, name FROM leads WHERE id = (SELECT referred_by FROM leads WHERE id = ?)").bind(id),
    db.prepare("SELECT * FROM people WHERE lead_id = ? ORDER BY decision_maker DESC, id").bind(id),
    db.prepare("SELECT * FROM tasks WHERE lead_id = ? ORDER BY done_at IS NOT NULL, due_at IS NULL, due_at, done_at DESC LIMIT 50").bind(id),
    db.prepare("SELECT * FROM activity WHERE lead_id = ? ORDER BY at DESC LIMIT 100").bind(id),
  ]);
  const lead = leadRes.results[0];
  if (!lead) return null;
  return { lead, touches: touches.results, meetings: meetings.results, deals: deals.results,
    referrals: referrals.results, referrer: referrer.results[0] || null,
    people: people.results, tasks: tasks.results, activity: activity.results };
}

function prepLead(body, s) {
  const row = clean(body, LEAD_FIELDS);
  if ("phone" in row) row.phone = normPhone(row.phone, row.country);
  if ("whatsapp" in row) row.whatsapp = normPhone(row.whatsapp, row.country);
  if (row.phone && !row.country) row.country = countryOf(row.phone);
  return row;
}

// ---------- tasks, activity ----------
// The lead's next_action / next_action_at mirror its earliest open task (the Today lists read those).
const syncNext = (db, leadId) => db.prepare(`UPDATE leads SET
    next_action = (SELECT title FROM tasks WHERE lead_id = ?1 AND done_at IS NULL ORDER BY due_at IS NULL, due_at LIMIT 1),
    next_action_at = (SELECT due_at FROM tasks WHERE lead_id = ?1 AND done_at IS NULL ORDER BY due_at IS NULL, due_at LIMIT 1),
    updated_at = ?2 WHERE id = ?1`).bind(leadId, nowIso());
const logAct = (db, leadId, entity, entityId, action, detail) =>
  db.prepare("INSERT INTO activity (lead_id, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?)").bind(leadId || null, entity, entityId || null, action, detail || null);
const newTask = (db, leadId, title, dueAt, kind = "follow_up") =>
  db.prepare("INSERT INTO tasks (lead_id, title, kind, due_at) VALUES (?, ?, ?, ?)").bind(leadId, title, kind, dueAt ? new Date(dueAt).toISOString() : null);
// Contact made: the open follow-ups that were waiting for it are done.
const closeFollowUps = (db, leadId, upTo) => db.prepare(`UPDATE tasks SET done_at = ? WHERE lead_id = ? AND done_at IS NULL
    AND kind IN ('follow_up','call','whatsapp','email') AND (due_at IS NULL OR due_at <= ?)`).bind(nowIso(), leadId, upTo);
const closeAllTasks = (db, leadId) => db.prepare("UPDATE tasks SET done_at = ? WHERE lead_id = ? AND done_at IS NULL").bind(nowIso(), leadId);
const endOfToday = () => dayStart(addDays(gulfDate(), 1));

async function createLead(db, body, env, s) {
  const row = prepLead(body, s);
  if (!row.name) return bad("Name is required");
  if (row.phone && !body.force) {
    const dup = await db.prepare("SELECT id, name FROM leads WHERE phone = ? OR whatsapp = ?").bind(row.phone, row.phone).first();
    if (dup) return json({ error: `Already in the CRM as ${dup.name}`, duplicate: dup }, 409);
  }
  if (row.inbound && !row.inbound_at) row.inbound_at = nowIso();
  if (row.inbound && !row.temperature) row.temperature = "hot";
  const taskTitle = row.inbound ? "Call within 5 minutes" : row.next_action;
  const taskDue = row.inbound ? row.inbound_at : row.next_action_at;
  delete row.next_action; delete row.next_action_at;
  const lead = await insert(db, "leads", row);
  const stmts = [logAct(db, lead.id, "lead", lead.id, "created", `Added from ${row.source || "other"}${row.inbound ? " (inbound)" : ""}`)];
  if (taskDue || taskTitle) stmts.push(newTask(db, lead.id, taskTitle || "Follow up", taskDue, row.inbound ? "call" : "follow_up"), syncNext(db, lead.id));
  await db.batch(stmts);
  if (body.notify && lead.inbound) await pingInbound(env, lead);
  return json({ lead: await db.prepare(`${LEAD_LIST_SQL} WHERE l.id = ?`).bind(lead.id).first() }, 201);
}

async function patchLead(db, id, body, s) {
  const before = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
  if (!before) return bad("Lead not found", 404);
  const row = prepLead(body, s);
  if (row.phone) {
    const dup = await db.prepare("SELECT id, name FROM leads WHERE (phone = ? OR whatsapp = ?) AND id != ?").bind(row.phone, row.phone, id).first();
    if (dup && !body.force) return json({ error: `That number belongs to ${dup.name}`, duplicate: dup }, 409);
  }
  // Follow-ups are tasks now: a next action sent here becomes (or clears) one.
  const stmts = [];
  if ("next_action_at" in row || "next_action" in row) {
    stmts.push(closeFollowUps(db, id, "9999"));
    if (row.next_action_at) stmts.push(newTask(db, id, row.next_action || "Follow up", row.next_action_at));
  }
  delete row.next_action; delete row.next_action_at;
  if (row.status === "lost" || row.status === "dnc") stmts.push(closeAllTasks(db, id));
  const changed = Object.keys(row).filter((k) => String(row[k] ?? "") !== String(before[k] ?? ""));
  const lead = await update(db, "leads", id, row);
  if (changed.length) stmts.push(logAct(db, id, "lead", id, row.status && row.status !== before.status ? "stage" : "updated",
    row.status && row.status !== before.status ? `${before.status} → ${row.status}` : `Edited ${changed.join(", ").replace(/_/g, " ")}`));
  if (stmts.length) { stmts.push(syncNext(db, id)); await db.batch(stmts); }
  return json({ lead: await db.prepare(`${LEAD_LIST_SQL} WHERE l.id = ?`).bind(id).first() || lead });
}

async function logTouch(db, body) {
  const leadId = Number(body.lead_id);
  const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first();
  if (!lead) return bad("Lead not found", 404);
  const t = clean(body, ["channel", "outcome", "note", "nos"]);
  t.direction = body.direction === "in" ? "in" : "out";
  t.lead_id = leadId;
  t.at = body.at ? new Date(body.at).toISOString() : nowIso();
  if (!t.outcome) return bad("Outcome is required");

  const row = {};
  if (t.direction === "out" && !lead.first_contact_at) row.first_contact_at = t.at;
  let status = REACHED.includes(t.outcome) ? "conversation" : "attempting";
  let terminal = false;
  if (t.outcome === "stay_in_touch") { row.temperature = "nurture"; if (body.nurture_reason) row.nurture_reason = body.nurture_reason; }
  if (t.outcome === "not_interested") { status = "lost"; row.lost_reason = body.lost_reason || "Not interested"; terminal = true; }
  if (t.outcome === "wrong_number") { status = "lost"; row.lost_reason = "Wrong number"; terminal = true; }
  if (t.outcome === "dnc_request") { status = "dnc"; terminal = true; }
  if ((status === "lost" || status === "dnc") && (STATUS_RANK[lead.status] ?? 0) >= STATUS_RANK.meeting_booked && t.outcome !== "dnc_request") {
    status = "conversation"; row.temperature = "cold"; // don't bury a lead that already met you; mark it cold instead
  }
  const st = nextStatus(lead.status, status);
  if (st) row.status = st;
  row.updated_at = nowIso();
  const tk = Object.keys(t), rk = Object.keys(row);
  const stmts = [
    db.prepare(`INSERT INTO touches (${tk.join(",")}) VALUES (${tk.map(() => "?").join(",")}) RETURNING *`).bind(...tk.map((k) => t[k])),
    db.prepare(`UPDATE leads SET ${rk.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...rk.map((k) => row[k]), leadId),
    // Reached / tried them: today's follow-ups are done; a new follow-up replaces any later one too.
    terminal ? closeAllTasks(db, leadId) : closeFollowUps(db, leadId, body.next_action_at ? "9999" : endOfToday()),
  ];
  if (!terminal && body.next_action_at) stmts.push(newTask(db, leadId, body.next_action || "Follow up", body.next_action_at, t.outcome === "callback" ? "call" : "follow_up"));
  if (st && st !== lead.status) stmts.push(logAct(db, leadId, "lead", leadId, "stage", `${lead.status} → ${st}`));
  stmts.push(syncNext(db, leadId), db.prepare(`${LEAD_LIST_SQL} WHERE l.id = ?`).bind(leadId));
  const res = await db.batch(stmts);
  return json({ touch: res[0].results[0], lead: res[res.length - 1].results[0] }, 201);
}

async function saveMeeting(db, body, id) {
  const m = clean(body, MEETING_FIELDS);
  let meeting, before = null;
  if (id) {
    before = await db.prepare("SELECT * FROM meetings WHERE id = ?").bind(id).first();
    if (!before) return bad("Meeting not found", 404);
    meeting = await update(db, "meetings", id, m, false);
  } else {
    if (!body.lead_id || !m.scheduled_at) return bad("Lead and time are required");
    meeting = await insert(db, "meetings", { ...m, lead_id: Number(body.lead_id) });
  }
  const leadId = meeting.lead_id;
  const row = {};
  const stmts = [];
  let status = "meeting_booked";
  if (!before) stmts.push(closeFollowUps(db, leadId, "9999"),
    logAct(db, leadId, "meeting", meeting.id, "created", `${meeting.kind === "site_visit" ? "Site visit" : "Meeting"} booked for ${meeting.scheduled_at.slice(0, 16)}Z`));
  if (meeting.status === "held") {
    status = "meeting_held";
    if (meeting.g1_pass && meeting.g2_pass && meeting.g3_pass) status = "qualified";
    if (meeting.lane) row.lane = meeting.lane;
    if (meeting.g1_goal) row.need = meeting.g1_goal;
    if (meeting.g3_budget_min) row.budget_min = meeting.g3_budget_min;
    if (meeting.g3_budget_max) row.budget_max = meeting.g3_budget_max;
    if (meeting.g3_funding) row.funding = meeting.g3_funding;
    if (meeting.g2_decision) row.decision_makers = meeting.g2_decision;
    if (meeting.g2_timeline === "hot") row.temperature = "hot";
    if (meeting.g2_timeline === "nurture") { row.temperature = "nurture"; if (meeting.g2_reason) row.nurture_reason = meeting.g2_reason; }
    if (meeting.outcome === "nurture") row.temperature = "nurture";
    if (meeting.next_call_at && meeting.next_call_at !== before?.next_call_at) {
      stmts.push(closeFollowUps(db, leadId, "9999"), newTask(db, leadId, "Decision call", meeting.next_call_at, "call"));
    }
    if (meeting.outcome === "disqualified" || meeting.outcome === "lost") {
      status = "lost"; row.lost_reason = meeting.outcome === "disqualified" ? "Disqualified at meeting" : "Lost after meeting";
      stmts.push(closeAllTasks(db, leadId));
    }
  }
  if ((meeting.status === "no_show" || meeting.status === "cancelled") && before?.status !== meeting.status) {
    stmts.push(newTask(db, leadId, "Rebook meeting", nowIso(), "call")); status = "conversation";
  }
  if (before && before.status !== meeting.status) stmts.push(logAct(db, leadId, "meeting", meeting.id, "stage", `Meeting ${before.status} → ${meeting.status}`));
  await advance(db, leadId, status, row);
  if (stmts.length) { stmts.push(syncNext(db, leadId)); await db.batch(stmts); }
  return json({ meeting }, id ? 200 : 201);
}

// Commission rate for a new deal: the project's own rate, else the developer's, else the fallback.
async function commissionFor(db, s, d) {
  if (d.inventory_id) {
    const inv = await db.prepare("SELECT commission_pct, developer FROM inventory WHERE id = ?").bind(d.inventory_id).first();
    if (!d.developer && inv?.developer) d.developer = inv.developer;
    if (inv?.commission_pct != null) return inv.commission_pct;
  }
  const dev = String(d.developer || "").trim().toLowerCase();
  const hit = dev && (s.developer_commissions || []).find((x) => String(x.developer || "").trim().toLowerCase() === dev);
  return hit ? Number(hit.pct) : s.commission_pct;
}

async function saveDeal(db, body, id, s) {
  const d = clean(body, DEAL_FIELDS);
  if (d.stage && STAGE_DATE[d.stage] && !d[STAGE_DATE[d.stage]]) {
    const existing = id ? await db.prepare("SELECT * FROM deals WHERE id = ?").bind(id).first() : null;
    if (!existing || !existing[STAGE_DATE[d.stage]]) d[STAGE_DATE[d.stage]] = nowIso();
  }
  let deal, prevStage = null;
  if (id) {
    prevStage = (await db.prepare("SELECT stage FROM deals WHERE id = ?").bind(id).first())?.stage;
    deal = await update(db, "deals", id, d);
    if (!deal) return bad("Deal not found", 404);
  } else {
    if (!body.lead_id) return bad("Lead is required");
    d.stage = d.stage || "eoi";
    if (d.stage === "eoi" && !d.eoi_at) d.eoi_at = nowIso();
    if (d.commission_pct == null) d.commission_pct = await commissionFor(db, s, d);
    if (d.split_pct == null) d.split_pct = s.split_pct;
    deal = await insert(db, "deals", { ...d, lead_id: Number(body.lead_id) });
  }
  if (CLOSED_STAGES.includes(deal.stage)) await advance(db, deal.lead_id, "won");
  else if (deal.stage === "fell_through") await update(db, "leads", deal.lead_id, { status: "qualified", temperature: "hot" });
  else await advance(db, deal.lead_id, "eoi");
  if (!id || prevStage !== deal.stage) await logAct(db, deal.lead_id, "deal", deal.id, id ? "stage" : "created",
    `${deal.project || "Deal"}: ${id ? `${prevStage} → ` : ""}${deal.stage}`).run();
  return json({ deal }, id ? 200 : 201);
}


// ---------- tasks ----------
const TASK_SQL = `SELECT t.*, l.name AS lead_name, l.phone AS lead_phone, l.whatsapp AS lead_whatsapp, l.country AS lead_country, l.temperature AS lead_temperature
  FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id`;
async function listTasks(db, url) {
  const p = url.searchParams;
  const where = [], bind = [];
  const scope = p.get("scope") || "open";
  if (scope === "open") where.push("t.done_at IS NULL");
  if (scope === "done") where.push("t.done_at IS NOT NULL");
  if (p.get("lead_id")) { where.push("t.lead_id = ?"); bind.push(Number(p.get("lead_id"))); }
  if (p.get("mine")) where.push("t.lead_id IS NULL");
  const order = scope === "done" ? "t.done_at DESC" : "t.due_at IS NULL, t.due_at, t.priority DESC";
  const rows = (await db.prepare(`${TASK_SQL}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 300`).bind(...bind).all()).results;
  return { tasks: rows };
}
async function saveTask(db, body, id) {
  const row = clean(body, ["title", "kind", "due_at", "priority", "notes"]);
  if ("lead_id" in body) row.lead_id = body.lead_id ? Number(body.lead_id) : null;
  if ("done" in body) row.done_at = body.done ? nowIso() : null;
  let task;
  if (id) {
    const before = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
    if (!before) return bad("Task not found", 404);
    task = await update(db, "tasks", id, row, false);
    const stmts = [];
    if (before.lead_id) stmts.push(syncNext(db, before.lead_id));
    if (task.lead_id && task.lead_id !== before.lead_id) stmts.push(syncNext(db, task.lead_id));
    if (row.done_at && !before.done_at) stmts.push(logAct(db, task.lead_id, "task", id, "completed", task.title));
    if (stmts.length) await db.batch(stmts);
  } else {
    if (!row.title) return bad("Task needs a title");
    task = await insert(db, "tasks", row);
    if (task.lead_id) await syncNext(db, task.lead_id).run();
  }
  return json({ task: await db.prepare(`${TASK_SQL} WHERE t.id = ?`).bind(task.id).first() }, id ? 200 : 201);
}

// ---------- people around a lead ----------
async function savePerson(db, body, id) {
  const row = clean(body, ["name", "relation", "phone", "email", "decision_maker", "linked_lead_id", "notes"]);
  if ("phone" in row) row.phone = normPhone(row.phone);
  if (id) return json({ person: await update(db, "people", id, row, false) });
  if (!body.lead_id || !row.name) return bad("Lead and name are required");
  const person = await insert(db, "people", { ...row, lead_id: Number(body.lead_id) });
  await logAct(db, person.lead_id, "person", person.id, "created", `${person.name}${person.relation ? ` (${person.relation})` : ""} added`).run();
  return json({ person }, 201);
}

// ---------- client payment schedule ----------
async function dealDetail(db, id) {
  const [d, inst] = await db.batch([
    db.prepare("SELECT d.*, l.name, l.phone, l.whatsapp FROM deals d JOIN leads l ON l.id = d.lead_id WHERE d.id = ?").bind(id),
    db.prepare("SELECT * FROM installments WHERE deal_id = ? ORDER BY due_date IS NULL, due_date, id").bind(id),
  ]);
  return d.results[0] ? { deal: d.results[0], installments: inst.results } : null;
}
// Replace the unpaid part of the schedule: [{ label, due_date, pct, amount_aed }]
async function savePlan(db, dealId, body) {
  const deal = await db.prepare("SELECT * FROM deals WHERE id = ?").bind(dealId).first();
  if (!deal) return bad("Deal not found", 404);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 60);
  const stmts = [db.prepare("DELETE FROM installments WHERE deal_id = ? AND paid_at IS NULL").bind(dealId)];
  for (const r of rows) {
    const pct = r.pct == null || r.pct === "" ? null : Number(r.pct);
    const amount = r.amount_aed ? Number(r.amount_aed) : pct != null && deal.price_aed ? Math.round(deal.price_aed * pct / 100) : null;
    stmts.push(db.prepare("INSERT INTO installments (deal_id, label, due_date, pct, amount_aed) VALUES (?, ?, ?, ?, ?)")
      .bind(dealId, r.label || null, r.due_date || null, pct, amount));
  }
  stmts.push(logAct(db, deal.lead_id, "deal", dealId, "updated", `Payment plan set (${rows.length} payments)`));
  await db.batch(stmts);
  return json(await dealDetail(db, dealId));
}

// ---------- calendar ----------
async function agenda(db, url) {
  const from = url.searchParams.get("from") || gulfDate();
  const to = url.searchParams.get("to") || addDays(from, 13);
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const [meetings, tasks, payments] = await db.batch([
    db.prepare(`SELECT m.*, l.name, l.phone, l.whatsapp, l.country FROM meetings m JOIN leads l ON l.id = m.lead_id
      WHERE m.scheduled_at >= ? AND m.scheduled_at < ? AND m.status NOT IN ('cancelled','rescheduled') ORDER BY m.scheduled_at`).bind(a, b),
    db.prepare(`${TASK_SQL} WHERE t.done_at IS NULL AND t.due_at >= ? AND t.due_at < ? ORDER BY t.due_at`).bind(a, b),
    db.prepare(`SELECT i.*, d.project, d.unit, d.lead_id, l.name FROM installments i JOIN deals d ON d.id = i.deal_id JOIN leads l ON l.id = d.lead_id
      WHERE i.paid_at IS NULL AND i.due_date >= ? AND i.due_date <= ? ORDER BY i.due_date`).bind(from, to),
  ]);
  return { from, to, meetings: meetings.results, tasks: tasks.results, payments: payments.results };
}

// ---------- duplicates & merge ----------
async function duplicates(db) {
  const rows = (await db.prepare("SELECT id, name, phone, whatsapp, email, status, source, created_at FROM leads").all()).results;
  const groups = new Map();
  const add = (key, r) => { if (!key) return; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); };
  for (const r of rows) {
    const d = String(r.phone || "").replace(/\D/g, "");
    if (d.length >= 9) add(`p:${d.slice(-9)}`, r);
    const w = String(r.whatsapp || "").replace(/\D/g, "");
    if (w.length >= 9 && w.slice(-9) !== d.slice(-9)) add(`p:${w.slice(-9)}`, r);
    if (r.email) add(`e:${r.email.trim().toLowerCase()}`, r);
    const n = String(r.name || "").toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, " ");
    if (n.split(" ").length >= 2) add(`n:${n}`, r);
  }
  const seen = new Set(), out = [];
  for (const [key, list] of groups) {
    const ids = [...new Set(list.map((r) => r.id))];
    if (ids.length < 2) continue;
    const sig = ids.sort((x, y) => x - y).join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ reason: key[0] === "p" ? "Same phone" : key[0] === "e" ? "Same email" : "Same name", leads: ids.map((id) => list.find((r) => r.id === id)) });
  }
  return { groups: out };
}
async function mergeLeads(db, keepId, otherId) {
  if (!otherId || keepId === otherId) return bad("Pick two different leads");
  const [k, o] = await Promise.all([db.prepare("SELECT * FROM leads WHERE id = ?").bind(keepId).first(), db.prepare("SELECT * FROM leads WHERE id = ?").bind(otherId).first()]);
  if (!k || !o) return bad("Lead not found", 404);
  const fill = {};
  for (const f of LEAD_FIELDS) if ((k[f] == null || k[f] === "") && o[f] != null && o[f] !== "") fill[f] = o[f];
  if (o.notes && k.notes && o.notes !== k.notes) fill.notes = `${k.notes}\n— merged from ${o.name} —\n${o.notes}`;
  if ((STATUS_RANK[o.status] ?? -1) > (STATUS_RANK[k.status] ?? -1)) fill.status = o.status;
  if (o.first_contact_at && (!k.first_contact_at || o.first_contact_at < k.first_contact_at)) fill.first_contact_at = o.first_contact_at;
  delete fill.next_action; delete fill.next_action_at;
  const stmts = ["touches", "meetings", "deals", "tasks", "people", "activity"].map((t) => db.prepare(`UPDATE ${t} SET lead_id = ? WHERE lead_id = ?`).bind(keepId, otherId));
  stmts.push(db.prepare("UPDATE leads SET referred_by = ? WHERE referred_by = ?").bind(keepId, otherId));
  stmts.push(db.prepare("UPDATE people SET linked_lead_id = ? WHERE linked_lead_id = ?").bind(keepId, otherId));
  const fk = Object.keys(fill);
  if (fk.length) stmts.push(db.prepare(`UPDATE leads SET ${fk.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`).bind(...fk.map((f) => fill[f]), keepId));
  stmts.push(db.prepare("DELETE FROM leads WHERE id = ?").bind(otherId));
  stmts.push(logAct(db, keepId, "lead", keepId, "merged", `Merged ${o.name}${o.phone ? ` (${o.phone})` : ""} into this lead`));
  stmts.push(syncNext(db, keepId));
  await db.batch(stmts);
  return json({ ok: true, id: keepId });
}

// ---------- bulk edits ----------
async function bulkLeads(db, body) {
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 1000);
  if (!ids.length) return bad("No leads selected");
  const marks = ids.map(() => "?").join(",");
  const stmts = [];
  if (body.delete) {
    stmts.push(db.prepare(`DELETE FROM leads WHERE id IN (${marks})`).bind(...ids));
    await db.batch(stmts);
    return json({ ok: true, deleted: ids.length });
  }
  const set = clean(body.set || {}, ["temperature", "status", "source", "icp", "lane", "dncr", "country"]);
  const sk = Object.keys(set);
  if (sk.length) stmts.push(db.prepare(`UPDATE leads SET ${sk.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id IN (${marks})`).bind(...sk.map((k) => set[k]), nowIso(), ...ids));
  if (set.status === "lost" || set.status === "dnc") stmts.push(db.prepare(`UPDATE tasks SET done_at = ? WHERE done_at IS NULL AND lead_id IN (${marks})`).bind(nowIso(), ...ids));
  if (body.add_tag) {
    const tag = String(body.add_tag).trim().slice(0, 40);
    stmts.push(db.prepare(`UPDATE leads SET tags = CASE WHEN tags IS NULL OR tags = '' THEN ?1
      WHEN (', ' || lower(tags) || ',') LIKE '%, ' || lower(?1) || ',%' THEN tags ELSE tags || ', ' || ?1 END, updated_at = ?2 WHERE id IN (${ids.map((_, i) => `?${i + 3}`).join(",")})`).bind(tag, nowIso(), ...ids));
  }
  if (body.task?.title) for (const id of ids) stmts.push(newTask(db, id, body.task.title, body.task.due_at || null));
  for (const id of ids) {
    stmts.push(syncNext(db, id));
    if (sk.length || body.add_tag) stmts.push(logAct(db, id, "lead", id, "updated", `Bulk edit: ${[...sk.map((k) => `${k} = ${set[k]}`), body.add_tag ? `tag ${body.add_tag}` : null].filter(Boolean).join(", ")}`));
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return json({ ok: true, updated: ids.length });
}

// ---------- numbers ----------
async function stats(db, url) {
  const s = await getSettings(db);
  const d = gulfDate();
  const from = url.searchParams.get("from") || mondayOf(d);
  const to = url.searchParams.get("to") || d;
  const a = dayStart(from), b = dayStart(addDays(to, 1));
  const q = (sql, ...bind) => db.prepare(sql).bind(...bind);
  // One round trip for everything on the Numbers screen.
  const [funnel, meetingsHeld, deals, sources, weeks, speed, allDeals, statusRows, tempRows, stalled, ...wk] = await db.batch([
    q(`SELECT COUNT(*) AS touches, COALESCE(SUM(outcome IN (${REACHED_SQL})),0) AS conversations,
        COALESCE(SUM(outcome='referral'),0) AS referrals_asked,
        (SELECT COUNT(*) FROM meetings WHERE booked_at >= ?1 AND booked_at < ?2) AS booked,
        (SELECT COUNT(*) FROM meetings WHERE scheduled_at >= ?1 AND scheduled_at < ?2 AND status IN ('held','no_show')) AS due,
        (SELECT COUNT(*) FROM meetings WHERE scheduled_at >= ?1 AND scheduled_at < ?2 AND status='held') AS held,
        (SELECT COUNT(*) FROM meetings WHERE scheduled_at >= ?1 AND scheduled_at < ?2 AND status='held' AND g1_pass=1 AND g2_pass=1 AND g3_pass=1) AS qualified,
        (SELECT COUNT(*) FROM deals WHERE eoi_at >= ?1 AND eoi_at < ?2) AS eoi,
        (SELECT COUNT(*) FROM deals WHERE booking_at >= ?1 AND booking_at < ?2 AND stage != 'fell_through') AS closed,
        (SELECT COUNT(*) FROM leads WHERE created_at >= ?1 AND created_at < ?2) AS new_leads,
        (SELECT COUNT(*) FROM leads WHERE referred_by IS NOT NULL AND created_at >= ?1 AND created_at < ?2) AS referrals_got
        FROM touches WHERE direction='out' AND at >= ?1 AND at < ?2`, a, b),
    q(`SELECT g1_pass, g2_pass, g3_pass, objections, close_score, outcome, g2_dm_present FROM meetings
        WHERE scheduled_at >= ? AND scheduled_at < ? AND status='held'`, a, b),
    q(`SELECT * FROM deals WHERE (booking_at >= ?1 AND booking_at < ?2) OR (eoi_at >= ?1 AND eoi_at < ?2)`, a, b),
    q(`SELECT l.source, COUNT(DISTINCT l.id) AS leads,
        COUNT(DISTINCT CASE WHEN t.outcome IN (${REACHED_SQL}) THEN l.id END) AS reached,
        COUNT(DISTINCT m.lead_id) AS met,
        COUNT(DISTINCT CASE WHEN dl.stage IN ('booking','spa','oqood','paid') THEN dl.lead_id END) AS won
        FROM leads l LEFT JOIN touches t ON t.lead_id = l.id LEFT JOIN meetings m ON m.lead_id = l.id
        LEFT JOIN deals dl ON dl.lead_id = l.id GROUP BY l.source ORDER BY leads DESC`),
    q(`SELECT date(at, '+4 hours', 'weekday 0', '-6 days') AS week, COUNT(*) AS touches,
        COALESCE(SUM(outcome IN (${REACHED_SQL})),0) AS conversations FROM touches WHERE direction='out' AND at >= ?
        GROUP BY week ORDER BY week`, dayStart(s.start_date < from ? s.start_date : from)),
    q(`SELECT inbound_at, first_contact_at FROM leads WHERE inbound = 1 AND inbound_at >= ? AND inbound_at < ?`, a, b),
    q(`SELECT d.*, l.name FROM deals d JOIN leads l ON l.id = d.lead_id ORDER BY d.created_at`),
    q(`SELECT status, COUNT(*) AS n FROM leads GROUP BY status`),
    q(`SELECT temperature, COUNT(*) AS n FROM leads WHERE ${OPEN} GROUP BY temperature`),
    q(`SELECT d.id, d.project, d.unit, d.stage, d.updated_at, l.name FROM deals d JOIN leads l ON l.id = d.lead_id
        WHERE d.stage NOT IN ('paid','fell_through') AND d.updated_at < ? ORDER BY d.updated_at`, new Date(Date.now() - 14 * 864e5).toISOString()),
    // Weekly table: meetings and deals per week too.
    q(`SELECT date(booked_at, '+4 hours', 'weekday 0', '-6 days') AS week, COUNT(*) AS n FROM meetings GROUP BY week`),
    q(`SELECT date(scheduled_at, '+4 hours', 'weekday 0', '-6 days') AS week, COUNT(*) AS held,
        SUM(g1_pass=1 AND g2_pass=1 AND g3_pass=1) AS qualified FROM meetings WHERE status='held' GROUP BY week`),
    q(`SELECT date(eoi_at, '+4 hours', 'weekday 0', '-6 days') AS week, COUNT(*) AS n FROM deals WHERE eoi_at IS NOT NULL GROUP BY week`),
    q(`SELECT date(booking_at, '+4 hours', 'weekday 0', '-6 days') AS week, COUNT(*) AS n,
        SUM(price_aed * commission_pct / 100.0 * split_pct / 100.0) AS net FROM deals
        WHERE booking_at IS NOT NULL AND stage != 'fell_through' GROUP BY week`),
  ]);
  const f = funnel.results[0];
  const byWeek = new Map();
  const W = (w) => { if (!byWeek.has(w)) byWeek.set(w, { week: w, touches: 0, conversations: 0, booked: 0, held: 0, qualified: 0, eoi: 0, closed: 0, net_aed: 0 }); return byWeek.get(w); };
  for (let w = mondayOf(s.start_date < from ? s.start_date : from); w <= mondayOf(d); w = addDays(w, 7)) W(w);
  for (const r of weeks.results) Object.assign(W(r.week), { touches: r.touches, conversations: r.conversations });
  for (const r of wk[0].results) W(r.week).booked = r.n;
  for (const r of wk[1].results) Object.assign(W(r.week), { held: r.held, qualified: r.qualified || 0 });
  for (const r of wk[2].results) W(r.week).eoi = r.n;
  for (const r of wk[3].results) Object.assign(W(r.week), { closed: r.n, net_aed: Math.round(r.net || 0) });

  const held = meetingsHeld.results;
  const objections = {};
  for (const m of held) { try { for (const o of JSON.parse(m.objections || "[]")) objections[o] = (objections[o] || 0) + 1; } catch (e) { /* ignore */ } }
  const leaks = {
    need: held.filter((m) => m.g1_pass === 0).length,
    decision: held.filter((m) => m.g2_pass === 0).length,
    budget: held.filter((m) => m.g3_pass === 0).length,
    no_dm: held.filter((m) => m.g2_dm_present === 0).length,
  };
  const scores = held.map((m) => m.close_score).filter((x) => x);
  const mins = speed.results.filter((r) => r.first_contact_at).map((r) => (Date.parse(r.first_contact_at) - Date.parse(r.inbound_at)) / 6e4).sort((x, y) => x - y);

  // Goal: net commission booked (closed) vs actually paid, all time.
  const live = allDeals.results.filter((x) => x.stage !== "fell_through");
  const closedDeals = live.filter((x) => CLOSED_STAGES.includes(x.stage));
  const paidDeals = live.filter((x) => x.stage === "paid" || x.commission_paid_at);
  const months = {};
  for (const x of closedDeals) { const m = gulfDate(new Date(x.booking_at || x.created_at)).slice(0, 7); months[m] = (months[m] || 0) + 1; }
  const rate = (n, dd) => (dd ? n / dd : null);
  return {
    from, to, settings: s, funnel: f,
    rates: {
      pickup: rate(f.conversations, f.touches), book: rate(f.booked, f.conversations),
      show: rate(f.held, f.due), close: rate(f.closed, f.held), qualified: rate(f.qualified, f.held),
    },
    leaks, objections, close_avg: scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null, held_n: held.length,
    speed: { n: speed.results.length, contacted: mins.length, median_min: mins.length ? mins[Math.floor(mins.length / 2)] : null,
      within5: mins.filter((x) => x <= 5).length },
    sources: sources.results,
    weeks: [...byWeek.values()].sort((x, y) => x.week.localeCompare(y.week)),
    period_deals: deals.results,
    goal: {
      closed_n: closedDeals.length, paid_n: paidDeals.length, eoi_open: live.filter((x) => ["eoi", "allocation"].includes(x.stage)).length,
      booked_net_aed: Math.round(closedDeals.reduce((t, x) => t + netAed(x), 0)),
      paid_net_aed: Math.round(paidDeals.reduce((t, x) => t + (x.commission_paid_aed || netAed(x)), 0)),
      pipeline_net_aed: Math.round(live.filter((x) => ["eoi", "allocation"].includes(x.stage)).reduce((t, x) => t + netAed(x), 0)),
      months, aed_per_usd: AED_PER_USD,
    },
    status: Object.fromEntries(statusRows.results.map((r) => [r.status, r.n])),
    temperature: Object.fromEntries(tempRows.results.map((r) => [r.temperature, r.n])),
    stalled: stalled.results,
  };
}

// ---------- Telegram ----------
async function telegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.ok;
}
async function pingInbound(env, lead) {
  const base = env.CRM_URL || "https://sanjay-market-brief.pages.dev";
  return telegram(env, [`🔥 <b>New inbound lead: call within 5 minutes</b>`, `${esc(lead.name)}${lead.phone ? ` · ${esc(lead.phone)}` : ""}`,
    lead.source_detail ? esc(lead.source_detail) : null, lead.notes ? `“${esc(lead.notes.slice(0, 200))}”` : null,
    `${base}/crm/#lead/${lead.id}`].filter(Boolean).join("\n"));
}

const fmtTime = (iso) => new Date(Date.parse(iso) + GST).toISOString().slice(11, 16);
const usd = (aed) => `$${Math.round(aed / AED_PER_USD).toLocaleString("en-US")}`;
const pct = (x) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

async function digest(db, env, kind) {
  const base = env.CRM_URL || "https://sanjay-market-brief.pages.dev";
  if (kind === "friday") {
    const d = gulfDate();
    const st = await stats(db, new URL(`https://x/?from=${mondayOf(d)}&to=${d}`));
    const s = st.settings, f = st.funnel, r = st.rates;
    const checks = [["Pick-up", r.pickup, s.rates.pickup], ["Booked", r.book, s.rates.book], ["Show-up", r.show, s.rates.show], ["Close", r.close, s.rates.close]];
    const leak = checks.filter((c) => c[1] != null).sort((x, y) => x[1] / x[2] - y[1] / y[2])[0];
    const lines = [
      `<b>Friday review · week of ${mondayOf(d)}</b>`,
      `Touches ${f.touches}/${s.weekly.touches} · conversations ${f.conversations}/${s.weekly.conversations} · booked ${f.booked}/${s.weekly.booked} · held ${f.held}/${s.weekly.held} · EOIs ${f.eoi}/${s.weekly.eoi}`,
      ...checks.map((c) => `${c[0]}: ${pct(c[1])} (target ${pct(c[2])})`),
      leak && leak[1] < leak[2] ? `⚠ <b>Leak to fix next week: ${leak[0]}</b>` : "✓ No rate below target",
      `Hot ${st.temperature.hot || 0} · nurture ${st.temperature.nurture || 0}`,
      st.stalled.length ? `Stalled deals (14+ days): ${st.stalled.map((x) => esc(`${x.name} (${x.stage})`)).join(", ")}` : null,
      `Closed ${st.goal.closed_n}/${s.deals_target} deals · booked ${usd(st.goal.booked_net_aed)} · paid ${usd(st.goal.paid_net_aed)} of $${s.goal_usd.toLocaleString("en-US")}`,
      `\n1. Which rate missed? Fix that one.\n2. Listen to 2 recorded calls: tonality + 3 gates.\n3. Update hot and nurture lists.\n4. Would a buyer pick you over 10 agents?`,
      `${base}/crm/#review`,
    ];
    const text = lines.filter(Boolean).join("\n");
    return { sent: await telegram(env, text), text };
  }
  const t = await today(db);
  const y = gulfDate(new Date(Date.now() - 864e5));
  const ys = await db.prepare(`SELECT COUNT(*) AS touches, COALESCE(SUM(outcome IN (${REACHED_SQL})),0) AS conversations
    FROM touches WHERE direction='out' AND at >= ? AND at < ?`).bind(dayStart(y), dayStart(t.date)).first();
  const s = t.settings;
  const lines = [
    `<b>CRM · ${t.date}</b>`,
    t.meetings.length ? `📅 Meetings today:\n${t.meetings.map((m) => `• ${fmtTime(m.scheduled_at)} ${esc(m.name)}${m.decision_maker_joining ? " (+ decision-maker)" : ""}: send the reminder now`).join("\n")}` : "📅 No meetings today",
    t.inbound.length ? `🔥 ${t.inbound.length} inbound lead(s) not called yet` : null,
    `⏰ ${t.overdue.length} overdue follow-ups · ${t.due.length} due today · ${t.hot.length} hot to call`,
    `Yesterday: ${ys.touches}/${s.daily_touches} touches · ${ys.conversations} conversations`,
    `This week: ${t.week.touches || 0}/${s.weekly.touches} touches · ${t.week.booked}/${s.weekly.booked} booked · ${t.week.held}/${s.weekly.held} held`,
    `Calling blocks 9:00–11:30 and 14:00–16:30. UAE numbers 9 AM–6 PM only.`,
    `${base}/crm/`,
  ];
  const text = lines.filter(Boolean).join("\n");
  return { sent: await telegram(env, text), text };
}

// ---------- CSV ----------
function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

async function importLeads(db, body) {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  const existing = new Set((await db.prepare("SELECT phone FROM leads WHERE phone IS NOT NULL").all()).results.map((r) => r.phone));
  const stmts = [];
  let skipped = 0, invalid = 0;
  for (const r of rows) {
    const row = prepLead({ source: body.source, country: body.country, icp: body.icp, ...r }, null);
    if (!row.name && !row.phone) { invalid++; continue; }
    if (!row.name) row.name = row.phone;
    if (row.phone && existing.has(row.phone)) { skipped++; continue; }
    if (row.phone) existing.add(row.phone);
    delete row.inbound; delete row.inbound_at;
    const keys = Object.keys(row);
    stmts.push(db.prepare(`INSERT INTO leads (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  if (stmts.length) await logAct(db, null, "lead", null, "imported", `Imported ${stmts.length} leads (${body.source || "other"})`).run();
  return json({ added: stmts.length, skipped, invalid });
}

// ---------- router ----------
export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const seg = [].concat(params.path || []);
  const [res, idRaw, sub] = seg;
  const id = idRaw ? Number(idRaw) : null;
  const method = request.method;
  const db = env.CRM;
  if (!db) return bad("The CRM database isn't connected yet. See README → CRM setup.", 503);
  const body = ["POST", "PATCH", "PUT"].includes(method) && res !== "inbound"
    ? await request.json().catch(() => ({})) : {};

  try {
    // Routes that bypass the cookie (the middleware lets them through) check their own key.
    if (res === "inbound" && method === "POST") {
      if (!env.DASHBOARD_PASSWORD || !sameString(url.searchParams.get("key") || "", await hmac(env.DASHBOARD_PASSWORD, "crm-inbound-v1"))) return bad("Bad key", 403);
      const ct = request.headers.get("content-type") || "";
      const raw = ct.includes("json") ? await request.json().catch(() => ({})) : Object.fromEntries(await request.formData().catch(() => new FormData()));
      const pick = (...ks) => { for (const k of ks) for (const [rk, v] of Object.entries(raw)) if (rk.toLowerCase().replace(/[\s_-]/g, "") === k && v) return String(v); return null; };
      const name = pick("name", "fullname", "firstname") || "Inbound lead";
      const phone = normPhone(pick("phone", "phonenumber", "mobile", "whatsapp", "tel"));
      const lead = { name, phone, email: pick("email"), source: url.searchParams.get("source") || pick("source") || "portal",
        source_detail: [url.searchParams.get("portal"), pick("project", "campaign", "form", "sourcedetail", "listing", "property")].filter(Boolean).join(" · ") || null,
        notes: pick("message", "notes", "comment", "comments"), inbound: 1, inbound_at: nowIso(), temperature: "hot", country: countryOf(phone) };
      const dup = phone ? await db.prepare("SELECT * FROM leads WHERE phone = ?").bind(phone).first() : null;
      const saved = dup
        ? await update(db, "leads", dup.id, { inbound: 1, inbound_at: lead.inbound_at, first_contact_at: null, temperature: "hot",
            notes: [dup.notes, `Inbound again ${gulfDate()}${[lead.source_detail, lead.notes].some(Boolean) ? `: ${[lead.source_detail, lead.notes].filter(Boolean).join(" · ")}` : ""}`].filter(Boolean).join("\n") })
        : await insert(db, "leads", lead);
      await db.batch([newTask(db, saved.id, "Call within 5 minutes", lead.inbound_at, "call"), syncNext(db, saved.id),
        logAct(db, saved.id, "lead", saved.id, dup ? "updated" : "created", `Inbound${lead.source_detail ? `: ${lead.source_detail}` : ""}`)]);
      await Promise.all([pingInbound(env, saved).catch(() => {}),
        notifyAll(db, { title: `🔥 ${saved.name}: call within 5 minutes`, body: [saved.phone, lead.source_detail, lead.notes].filter(Boolean).join(" · ").slice(0, 180),
          url: `/#lead/${saved.id}`, tag: `inbound-${saved.id}` }).catch(() => {})]);
      return json({ ok: true, id: saved.id, duplicate: !!dup }, 201);
    }
    if (res === "digest" && method === "POST") {
      const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (!env.DASHBOARD_PASSWORD || !sameString(auth, await hmac(env.DASHBOARD_PASSWORD, "crm-cron-v1"))) return bad("Bad key", 403);
      return json(await digest(db, env, url.searchParams.get("kind") || "morning"));
    }

    const s = await getSettings(db);
    if (res === "today" && method === "GET") return json(await today(db));
    if (res === "stats" && method === "GET") return json(await stats(db, url));
    if (res === "settings") {
      if (method === "GET") return json({ settings: s, has_telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        inbound_url: env.DASHBOARD_PASSWORD ? `${url.origin}/api/crm/inbound?key=${await hmac(env.DASHBOARD_PASSWORD, "crm-inbound-v1")}` : null });
      if (method === "PUT") {
        const stmts = Object.entries(body).filter(([k]) => k in DEFAULTS)
          .map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, JSON.stringify(v)));
        if (stmts.length) await db.batch(stmts);
        return json({ settings: await getSettings(db, true) });
      }
    }
    if (res === "test-telegram" && method === "POST") return json({ sent: await telegram(env, "✅ CRM alerts are working.") });

    if (res === "leads") {
      if (!id && method === "GET") return json(await listLeads(db, url));
      if (idRaw === "bulk" && method === "POST") return bulkLeads(db, body);
      if (!id && method === "POST") return createLead(db, body, env, s);
      if (id && method === "GET") { const d = await leadDetail(db, id); return d ? json(d) : bad("Lead not found", 404); }
      if (id && method === "PATCH") return patchLead(db, id, body, s);
      if (id && sub === "merge" && method === "POST") return mergeLeads(db, id, Number(body.other_id));
      if (id && method === "DELETE") { await db.prepare("DELETE FROM leads WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "touches") {
      if (!id && method === "POST") return logTouch(db, body);
      if (id && method === "DELETE") { await db.prepare("DELETE FROM touches WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "meetings") {
      if (!id && method === "GET") {
        const from = url.searchParams.get("from") || gulfDate();
        const rows = (await db.prepare(`SELECT m.*, l.name, l.phone, l.whatsapp FROM meetings m JOIN leads l ON l.id = m.lead_id
          WHERE m.scheduled_at >= ? ORDER BY m.scheduled_at LIMIT 200`).bind(dayStart(from)).all()).results;
        return json({ meetings: rows });
      }
      if (id && method === "GET") {
        const m = await db.prepare("SELECT m.*, l.name, l.phone, l.whatsapp, l.country FROM meetings m JOIN leads l ON l.id = m.lead_id WHERE m.id = ?").bind(id).first();
        return m ? json({ meeting: m }) : bad("Meeting not found", 404);
      }
      if (method === "POST" && !id) return saveMeeting(db, body, null);
      if (method === "PATCH" && id) return saveMeeting(db, body, id);
      if (method === "DELETE" && id) { await db.prepare("DELETE FROM meetings WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "deals") {
      if (!id && method === "GET") {
        const rows = (await db.prepare(`SELECT d.*, l.name, l.phone,
          (SELECT due_date FROM installments i WHERE i.deal_id = d.id AND i.paid_at IS NULL ORDER BY due_date LIMIT 1) AS next_payment_date,
          (SELECT amount_aed FROM installments i WHERE i.deal_id = d.id AND i.paid_at IS NULL ORDER BY due_date LIMIT 1) AS next_payment_aed
          FROM deals d JOIN leads l ON l.id = d.lead_id ORDER BY d.updated_at DESC`).all()).results;
        return json({ deals: rows, aed_per_usd: AED_PER_USD });
      }
      if (!id && method === "POST") return saveDeal(db, body, null, s);
      if (id && sub === "plan" && method === "PUT") return savePlan(db, id, body);
      if (id && method === "GET") { const d = await dealDetail(db, id); return d ? json(d) : bad("Deal not found", 404); }
      if (id && method === "PATCH") return saveDeal(db, body, id, s);
      if (id && method === "DELETE") { await db.prepare("DELETE FROM deals WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "inventory") {
      if (!id && method === "GET") return json({ inventory: (await db.prepare("SELECT * FROM inventory ORDER BY status = 'active' DESC, lane, project").all()).results });
      if (!id && method === "POST") {
        const row = clean(body, INVENTORY_FIELDS);
        if (!row.project) return bad("Project is required");
        if (row.commission_pct == null && row.developer) {
          const hit = (s.developer_commissions || []).find((x) => String(x.developer || "").trim().toLowerCase() === row.developer.toLowerCase());
          if (hit) row.commission_pct = Number(hit.pct);
        }
        return json({ item: await insert(db, "inventory", row) }, 201);
      }
      if (id && method === "PATCH") return json({ item: await update(db, "inventory", id, clean(body, INVENTORY_FIELDS), false) });
      if (id && method === "DELETE") { await db.prepare("DELETE FROM inventory WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "tasks") {
      if (!id && method === "GET") return json(await listTasks(db, url));
      if (!id && method === "POST") return saveTask(db, body, null);
      if (id && method === "PATCH") return saveTask(db, body, id);
      if (id && method === "DELETE") {
        const t = await db.prepare("DELETE FROM tasks WHERE id = ? RETURNING lead_id").bind(id).first();
        if (t?.lead_id) await syncNext(db, t.lead_id).run();
        return json({ ok: true });
      }
    }
    if (res === "people") {
      if (!id && method === "POST") return savePerson(db, body, null);
      if (id && method === "PATCH") return savePerson(db, body, id);
      if (id && method === "DELETE") { await db.prepare("DELETE FROM people WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "installments" && id) {
      if (method === "PATCH") {
        const row = clean(body, ["label", "due_date", "pct", "amount_aed", "paid_at", "notes"]);
        if ("paid" in body) row.paid_at = body.paid ? nowIso() : null;
        return json({ installment: await update(db, "installments", id, row, false) });
      }
      if (method === "DELETE") { await db.prepare("DELETE FROM installments WHERE id = ?").bind(id).run(); return json({ ok: true }); }
    }
    if (res === "agenda" && method === "GET") return json(await agenda(db, url));
    if (res === "duplicates" && method === "GET") return json(await duplicates(db));
    if (res === "push") {
      if (idRaw === "key" && method === "GET") return json({ publicKey: (await vapidKeys(db)).publicKey });
      if (idRaw === "subscribe" && method === "POST") {
        const sub2 = body.subscription || body;
        if (!sub2?.endpoint || !sub2?.keys?.p256dh || !sub2?.keys?.auth) return bad("Bad subscription");
        await db.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`)
          .bind(sub2.endpoint, sub2.keys.p256dh, sub2.keys.auth, String(body.device || "").slice(0, 80)).run();
        return json({ ok: true });
      }
      if (idRaw === "unsubscribe" && method === "POST") { await db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(body.endpoint || "").run(); return json({ ok: true }); }
      if (idRaw === "devices" && method === "GET") return json({ devices: (await db.prepare("SELECT device, created_at FROM push_subs").all()).results });
      if (idRaw === "test" && method === "POST") return json(await notifyAll(db, { title: "✅ Notifications are on", body: "Inbound leads, meetings and due tasks will show up here.", url: "/#today", tag: "test" }));
    }
    if (res === "import" && method === "POST") return importLeads(db, body);
    if (res === "export" && method === "GET") {
      const table = url.searchParams.get("table") || "leads";
      if (table === "all") {
        const out = {};
        for (const t of ["leads", "touches", "meetings", "deals", "inventory", "tasks", "people", "installments", "activity", "settings"]) out[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results;
        return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json",
          "content-disposition": `attachment; filename="crm-backup-${gulfDate()}.json"` } });
      }
      if (!["leads", "touches", "meetings", "deals", "inventory", "tasks", "people", "installments", "activity"].includes(table)) return bad("Unknown table");
      const rows = (await db.prepare(`SELECT * FROM ${table}`).all()).results;
      return new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="crm-${table}-${gulfDate()}.csv"` } });
    }
    return bad("Not found", 404);
  } catch (e) {
    return bad(`Server error: ${e.message}`, 500);
  }
}
