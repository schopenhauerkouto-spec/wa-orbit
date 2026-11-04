-- WA Orbit relationship memory, status intelligence, interaction policy and message drafts
CREATE TABLE IF NOT EXISTS wa_relationship_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL DEFAULT 'topic',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'conversation',
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  last_seen_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_relationship_memory_contact
  ON wa_relationship_memory(contact_id, importance DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS wa_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  contact_id TEXT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'text',
  text_content TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  detected_topics_json TEXT NOT NULL DEFAULT '[]',
  interest_score INTEGER NOT NULL DEFAULT 0 CHECK (interest_score BETWEEN 0 AND 100),
  relationship_score INTEGER NOT NULL DEFAULT 0 CHECK (relationship_score BETWEEN 0 AND 100),
  opportunity_score INTEGER NOT NULL DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
  decision TEXT NOT NULL DEFAULT 'ignore' CHECK (decision IN ('ignore','view','react','reply','remember','continue')),
  decision_reason TEXT NOT NULL DEFAULT '',
  interaction_state TEXT NOT NULL DEFAULT 'pending' CHECK (interaction_state IN ('pending','planned','done','skipped')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_status_events_contact
  ON wa_status_events(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_interest_profiles (
  contact_id TEXT PRIMARY KEY REFERENCES wa_contacts(id) ON DELETE CASCADE,
  topics_json TEXT NOT NULL DEFAULT '{}',
  curiosity_threshold INTEGER NOT NULL DEFAULT 55 CHECK (curiosity_threshold BETWEEN 0 AND 100),
  status_interaction_cooldown_hours INTEGER NOT NULL DEFAULT 24 CHECK (status_interaction_cooldown_hours BETWEEN 1 AND 720),
  max_status_interactions_7d INTEGER NOT NULL DEFAULT 3 CHECK (max_status_interactions_7d BETWEEN 0 AND 50),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_interaction_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status_reply_threshold INTEGER NOT NULL DEFAULT 72 CHECK (status_reply_threshold BETWEEN 0 AND 100),
  status_reaction_threshold INTEGER NOT NULL DEFAULT 58 CHECK (status_reaction_threshold BETWEEN 0 AND 100),
  status_remember_threshold INTEGER NOT NULL DEFAULT 45 CHECK (status_remember_threshold BETWEEN 0 AND 100),
  max_status_interactions_per_contact_7d INTEGER NOT NULL DEFAULT 3 CHECK (max_status_interactions_per_contact_7d BETWEEN 0 AND 50),
  min_hours_between_status_interactions INTEGER NOT NULL DEFAULT 24 CHECK (min_hours_between_status_interactions BETWEEN 1 AND 720),
  social_energy_daily INTEGER NOT NULL DEFAULT 10 CHECK (social_energy_daily BETWEEN 0 AND 50),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO wa_interaction_policy (id, updated_at) VALUES (1, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS wa_message_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (source_type IN ('follow_up','status','conversation','manual')),
  source_id TEXT,
  intent TEXT NOT NULL DEFAULT 'reconnect',
  tone TEXT NOT NULL DEFAULT 'natural',
  body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'rule_engine',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','discarded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_message_drafts_contact
  ON wa_message_drafts(contact_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_conversation_memory (
  contact_id TEXT PRIMARY KEY REFERENCES wa_contacts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  last_intent TEXT NOT NULL DEFAULT '',
  last_topics_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO wa_interest_profiles (contact_id, updated_at)
SELECT id, CURRENT_TIMESTAMP FROM wa_contacts;

INSERT OR IGNORE INTO wa_conversation_memory (contact_id, updated_at)
SELECT id, CURRENT_TIMESTAMP FROM wa_contacts;
