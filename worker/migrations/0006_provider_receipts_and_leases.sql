-- Provider delivery receipts and durable action leases.
ALTER TABLE webhook_statuses ADD COLUMN status_timestamp TEXT;
ALTER TABLE webhook_statuses ADD COLUMN errors_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE wa_action_queue ADD COLUMN provider_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE wa_action_queue ADD COLUMN provider_status_at TEXT;
ALTER TABLE wa_action_queue ADD COLUMN provider_error_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_wa_action_queue_provider_message_id
  ON wa_action_queue(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
