-- CRM database (Cloudflare D1, binding CRM). Times are UTC ISO strings; the app buckets them in Gulf time.

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,                       -- normalised: +971..., +91..., +1...
  whatsapp TEXT,                    -- only when different from phone
  email TEXT,
  country TEXT,                     -- AE / IN / US / UK / other ISO code
  city TEXT,
  icp TEXT DEFAULT 'nri',           -- nri (Indian/NRI abroad) · upgrader (Dubai renter) · other
  job_title TEXT,
  company TEXT,
  source TEXT DEFAULT 'other',      -- warm · lyka · content · linkedin · apollo · db · portal · referral · ads · other
  source_detail TEXT,
  referred_by INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  inbound INTEGER DEFAULT 0,        -- 1 = they came to you (form, portal, DM): the 5-minute rule applies
  inbound_at TEXT,
  first_contact_at TEXT,            -- first outbound touch after creation (speed-to-lead)
  status TEXT DEFAULT 'new',        -- new · attempting · conversation · meeting_booked · meeting_held · qualified · eoi · won · lost · dnc
  temperature TEXT DEFAULT 'warm',  -- hot (this launch/month) · warm · nurture (real later reason) · cold
  lane TEXT,                        -- waterfront · growth · value
  need TEXT,                        -- investment · rental · growth · residency · end_use · retire · diversify
  budget_min INTEGER,               -- AED
  budget_max INTEGER,
  funding TEXT,                     -- cash · mortgage · mixed
  decision_makers TEXT,
  timeline TEXT,
  next_action TEXT,
  next_action_at TEXT,
  dncr TEXT DEFAULT 'unknown',      -- UAE Do Not Call Registry: unknown · clear · listed
  lost_reason TEXT,
  nurture_reason TEXT,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX leads_phone ON leads(phone);
CREATE INDEX leads_status ON leads(status);
CREATE INDEX leads_next ON leads(next_action_at);

-- Every dial, WhatsApp, email: the raw material for the funnel numbers.
CREATE TABLE touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  channel TEXT NOT NULL DEFAULT 'call',   -- call · whatsapp · email · sms
  direction TEXT NOT NULL DEFAULT 'out',  -- out · in
  outcome TEXT NOT NULL,                  -- no_answer · busy · voicemail · wrong_number · sent · replied · conversation · callback · booked · stay_in_touch · referral · not_interested · dnc_request
  nos INTEGER DEFAULT 0,                  -- how many nos before you hung up (Saad: leave after three)
  note TEXT
);
CREATE INDEX touches_lead ON touches(lead_id, at);
CREATE INDEX touches_at ON touches(at);

-- The 30-minute sales call, gate by gate.
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  kind TEXT DEFAULT 'video',              -- video · site_visit · office · phone
  status TEXT DEFAULT 'booked',           -- booked · held · no_show · rescheduled · cancelled
  decision_maker_joining INTEGER DEFAULT 0,
  attendees TEXT,
  booked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Gate 1: need
  g1_goal TEXT, g1_why TEXT, g1_tried TEXT, g1_realign TEXT, g1_pass INTEGER,
  -- Gate 2: decision-maker and timeline
  g2_decision TEXT, g2_dm_present INTEGER, g2_timeline TEXT, g2_reason TEXT, g2_pass INTEGER,
  -- Gate 3: budget
  g3_budget_min INTEGER, g3_budget_max INTEGER, g3_down_payment INTEGER, g3_funding TEXT, g3_access TEXT, g3_pass INTEGER,
  lane TEXT,
  belief_break TEXT,
  units_shown TEXT,
  close_score INTEGER,                    -- 1-10 close
  why_not_lower TEXT,
  to_ten TEXT,                            -- "what would make it a 10?"
  objections TEXT,                        -- JSON array of objection keys
  outcome TEXT,                           -- eoi · next_call · nurture · disqualified · lost
  next_call_at TEXT,
  notes TEXT
);
CREATE INDEX meetings_lead ON meetings(lead_id);
CREATE INDEX meetings_at ON meetings(scheduled_at);

-- Off-plan deal: EOI -> allocation -> booking -> SPA -> Oqood -> commission paid.
CREATE TABLE deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
  project TEXT, developer TEXT, unit TEXT, lane TEXT,
  price_aed INTEGER,
  commission_pct REAL,                    -- what the developer pays the agency, % of price
  split_pct REAL,                         -- your share of that, %
  stage TEXT DEFAULT 'eoi',               -- eoi · allocation · booking · spa · oqood · paid · fell_through
  eoi_at TEXT, eoi_amount INTEGER, eoi_refundable INTEGER DEFAULT 1,
  allocation_at TEXT, booking_at TEXT, spa_at TEXT, oqood_at TEXT,
  commission_expected_at TEXT,
  commission_paid_at TEXT, commission_paid_aed INTEGER,
  fell_through_at TEXT, fell_through_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX deals_lead ON deals(lead_id);

-- The Launch Filter: only units that pass all three checks get shown.
CREATE TABLE inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL, developer TEXT, area TEXT,
  lane TEXT,                              -- waterfront · growth · value
  unit_types TEXT, price_from_aed INTEGER, down_payment_pct REAL, payment_plan TEXT, handover TEXT,
  f_delivery INTEGER DEFAULT 0, f_growth INTEGER DEFAULT 0, f_payment INTEGER DEFAULT 0,
  filter_notes TEXT, eoi_deadline TEXT, link TEXT,
  status TEXT DEFAULT 'active',           -- active · sold_out · archived
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
