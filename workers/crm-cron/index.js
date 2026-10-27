// CRM scheduler (Cloudflare Worker, cron every 5 minutes, free plan). Sends phone notifications:
//   - an inbound lead still not called after 5 minutes
//   - a meeting in 60 minutes (send the WhatsApp reminder) and in 10 minutes
//   - a task that just fell due
//   - the morning plan at ~07:45 Gulf time
// Each notification is sent once (table notified). Deployed by .github/workflows/daily.yml.
import { notifyOnce } from "../../lib/crm/push.js";

const GST = 4 * 3600e3;
const gulf = (d = new Date()) => new Date(d.getTime() + GST).toISOString();
const hhmm = (iso) => gulf(new Date(iso)).slice(11, 16);
const dayStart = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - GST).toISOString();

async function run(env) {
  const db = env.CRM;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const [inbound, meetings, tasks] = await db.batch([
    db.prepare(`SELECT id, name, phone, inbound_at FROM leads WHERE inbound = 1 AND first_contact_at IS NULL
      AND status NOT IN ('lost','dnc') AND inbound_at < ? AND inbound_at > ?`).bind(iso(now - 5 * 6e4), iso(now - 6 * 3600e3)),
    db.prepare(`SELECT m.id, m.scheduled_at, m.kind, m.decision_maker_joining, l.name, l.id AS lead_id FROM meetings m JOIN leads l ON l.id = m.lead_id
      WHERE m.status = 'booked' AND m.scheduled_at > ? AND m.scheduled_at <= ?`).bind(iso(now), iso(now + 65 * 6e4)),
    db.prepare(`SELECT t.id, t.title, t.due_at, t.lead_id, l.name FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
      WHERE t.done_at IS NULL AND t.due_at > ? AND t.due_at <= ?`).bind(iso(now - 15 * 6e4), iso(now + 6e4)),
  ]);
  const jobs = [];
  for (const l of inbound.results) {
    const mins = Math.round((now - Date.parse(l.inbound_at)) / 6e4);
    jobs.push(notifyOnce(db, `inbound5-${l.id}-${l.inbound_at}`, { title: `⏱ ${l.name} has waited ${mins} min`,
      body: `Inbound lead not called yet${l.phone ? ` · ${l.phone}` : ""}. Speed wins this one.`, url: `/#lead/${l.id}`, tag: `inbound-${l.id}` }));
  }
  for (const m of meetings.results) {
    const mins = (Date.parse(m.scheduled_at) - now) / 6e4;
    const what = m.kind === "site_visit" ? "Site visit" : "Meeting";
    if (mins > 40) jobs.push(notifyOnce(db, `meet60-${m.id}-${m.scheduled_at}`, { title: `${what} at ${hhmm(m.scheduled_at)}: ${m.name}`,
      body: `Send the WhatsApp reminder now.${m.decision_maker_joining ? "" : " Decision-maker not confirmed yet."}`, url: `/#meeting/${m.id}`, tag: `meet-${m.id}` }));
    if (mins <= 12) jobs.push(notifyOnce(db, `meet10-${m.id}-${m.scheduled_at}`, { title: `${what} in ${Math.max(1, Math.round(mins))} min: ${m.name}`,
      body: "Open the prep: context, 3 gates, 1–10 close.", url: `/#meeting/${m.id}`, tag: `meet-${m.id}` }));
  }
  for (const t of tasks.results) {
    jobs.push(notifyOnce(db, `task-${t.id}-${t.due_at}`, { title: t.name ? `${t.title}: ${t.name}` : t.title,
      body: `Due ${hhmm(t.due_at)}`, url: t.lead_id ? `/#lead/${t.lead_id}` : "/#tasks", tag: `task-${t.id}`, urgency: "normal" }));
  }
  // Morning plan, once a day between 07:40 and 08:30 Gulf time.
  const g = gulf();
  const mins = Number(g.slice(11, 13)) * 60 + Number(g.slice(14, 16));
  if (mins >= 460 && mins <= 510) {
    const date = g.slice(0, 10);
    const a = dayStart(date), b = new Date(Date.parse(a) + 864e5).toISOString();
    const [mt, due, over, pay] = await db.batch([
      db.prepare("SELECT COUNT(*) AS n, MIN(scheduled_at) AS first FROM meetings WHERE status = 'booked' AND scheduled_at >= ? AND scheduled_at < ?").bind(a, b),
      db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND due_at >= ? AND due_at < ?").bind(a, b),
      db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND due_at < ?").bind(a),
      db.prepare("SELECT COUNT(*) AS n FROM installments WHERE paid_at IS NULL AND due_date <= ?").bind(date),
    ]);
    const m = mt.results[0];
    const parts = [m.n ? `${m.n} meeting${m.n > 1 ? "s" : ""} (first ${hhmm(m.first)})` : "No meetings",
      `${due.results[0].n} due today`, over.results[0].n ? `${over.results[0].n} overdue` : null,
      pay.results[0].n ? `${pay.results[0].n} client payment${pay.results[0].n > 1 ? "s" : ""} due` : null].filter(Boolean);
    jobs.push(notifyOnce(db, `morning-${date}`, { title: "Today's plan", body: `${parts.join(" · ")}. Calling blocks 9:00 and 14:00.`, url: "/#today", tag: "morning", urgency: "normal" }));
  }
  await Promise.all(jobs.map((j) => j.catch(() => null)));
  // Keep the "already sent" list short.
  await db.prepare("DELETE FROM notified WHERE at < ?").bind(iso(now - 14 * 864e5)).run();
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  // Manual check: GET /run on the worker (not routed publicly; workers_dev is off).
  async fetch() { return new Response("CRM scheduler", { status: 200 }); },
};
