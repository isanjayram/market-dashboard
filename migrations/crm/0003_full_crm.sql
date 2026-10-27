-- Full CRM: tasks, household / decision-makers, client payment schedules, activity log, phone notifications.

-- Tasks replace the single "next action" per lead. The lead keeps next_action / next_action_at as a copy of
-- its earliest open task, so the Today lists stay one simple query.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,   -- NULL = a task of your own (admin, content…)
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'follow_up',     -- follow_up · call · whatsapp · email · meeting_prep · admin · content
  due_at TEXT,
  priority INTEGER DEFAULT 0,        -- 1 = important
  done_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tasks_open ON tasks(done_at, due_at);
CREATE INDEX tasks_lead ON tasks(lead_id);

-- Bring each lead's current follow-up across as an open task.
INSERT INTO tasks (lead_id, title, kind, due_at)
  SELECT id, COALESCE(next_action, 'Follow up'), 'follow_up', next_action_at FROM leads
  WHERE next_action_at IS NOT NULL AND status NOT IN ('lost', 'dnc');

-- People around a lead: spouse, parents, business partner. Gate 2 is about them.
CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relation TEXT,                     -- spouse · parent · partner · sibling · child · advisor · other
  phone TEXT,
  email TEXT,
  decision_maker INTEGER DEFAULT 0,  -- 1 = has to say yes
  linked_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX people_lead ON people(lead_id);

-- The buyer's payment plan after booking (e.g. 10% booking, 10% in 3 months, 40% during construction, 40% on handover).
CREATE TABLE installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  label TEXT,
  due_date TEXT,                     -- YYYY-MM-DD
  pct REAL,
  amount_aed INTEGER,
  paid_at TEXT,
  notes TEXT
);
CREATE INDEX installments_deal ON installments(deal_id);
CREATE INDEX installments_due ON installments(paid_at, due_date);

-- What changed, when: stage moves, edits, merges.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  entity TEXT,                       -- lead · deal · meeting · task · person · installment
  entity_id INTEGER,
  action TEXT,                       -- created · updated · stage · completed · merged · deleted · imported
  detail TEXT                        -- short human text
);
CREATE INDEX activity_lead ON activity(lead_id, at);

-- Phone notifications (Web Push) and what has already been sent, so nothing repeats.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE notified (key TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));

-- Server-only values (the push signing key). Never sent to the page.
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
