CREATE TABLE IF NOT EXISTS wa_contacts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','opted_in','opted_out')),
  consent_source TEXT NOT NULL DEFAULT '',
  consent_at TEXT,
  opted_out_at TEXT,
  last_contacted_at TEXT,
  cooldown_until TEXT,
  last_interaction_at TEXT,
  conversation_state TEXT NOT NULL DEFAULT 'new' CHECK (conversation_state IN ('new','waiting','active','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_eligible
  ON wa_contacts(consent_status, cooldown_until, conversation_state, last_contacted_at);
CREATE TABLE IF NOT EXISTS wa_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK (paused IN (0,1)),
  daily_limit INTEGER NOT NULL DEFAULT 5 CHECK (daily_limit BETWEEN 1 AND 5),
  cooldown_days INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO wa_settings (id, paused, daily_limit, cooldown_days, updated_at)
VALUES (1, 1, 5, 30, CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wa_daily_selections (
  selection_date TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'selected' CHECK (state IN ('selected','queued','sent','cancelled')),
  selected_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (selection_date, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_daily_selections_contact
  ON wa_daily_selections(contact_id, selection_date DESC);
