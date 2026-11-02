CREATE TABLE IF NOT EXISTS webhook_messages (
  message_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'unknown',
  message_text TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_messages_phone_received
  ON webhook_messages(phone, received_at DESC);

CREATE TABLE IF NOT EXISTS webhook_statuses (
  message_id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  updated_at TEXT NOT NULL
);
