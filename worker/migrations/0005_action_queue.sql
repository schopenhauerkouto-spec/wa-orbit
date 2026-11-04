-- WA Orbit outbound action queue: idempotent claims, retries and auditability
CREATE TABLE IF NOT EXISTS wa_action_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES wa_message_drafts(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'send_text' CHECK (action_type IN ('send_text','react','mark_read')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  scheduled_at TEXT NOT NULL,
  processing_started_at TEXT,
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_action_queue_ready
  ON wa_action_queue(status, scheduled_at, id);
CREATE INDEX IF NOT EXISTS idx_wa_action_queue_contact
  ON wa_action_queue(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_action_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER REFERENCES wa_action_queue(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES wa_contacts(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_action_audit_action
  ON wa_action_audit(action_id, created_at DESC);
