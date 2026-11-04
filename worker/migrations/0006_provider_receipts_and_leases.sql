-- Provider delivery receipts and durable action leases.
ALTER TABLE webhook_statuses ADD COLUMN status_timestamp TEXT;
ALTER TABLE webhook_statuses ADD COLUMN errors_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE wa_action_queue ADD COLUMN provider_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE wa_action_queue ADD COLUMN provider_status_at TEXT;
ALTER TABLE wa_action_queue ADD COLUMN provider_error_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE wa_action_queue ADD COLUMN send_mode TEXT NOT NULL DEFAULT 'text' CHECK (send_mode IN ('text','template'));
CREATE INDEX IF NOT EXISTS idx_wa_action_queue_provider_message_id
  ON wa_action_queue(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
ALTER TABLE webhook_statuses ADD COLUMN status_rank INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wa_action_queue ADD COLUMN provider_status_rank INTEGER NOT NULL DEFAULT 0;
UPDATE webhook_statuses
SET status_rank = CASE status
  WHEN 'sent' THEN 1
  WHEN 'delivered' THEN 2
  WHEN 'read' THEN 3
  WHEN 'failed' THEN 4
  ELSE 0
END;
UPDATE wa_action_queue
SET provider_status_rank = CASE provider_status
  WHEN 'sent' THEN 1
  WHEN 'delivered' THEN 2
  WHEN 'read' THEN 3
  WHEN 'failed' THEN 4
  ELSE 0
END;
ALTER TABLE wa_contacts ADD COLUMN last_inbound_at TEXT;
UPDATE wa_contacts
SET last_inbound_at = (
  SELECT MAX(webhook_messages.received_at)
  FROM webhook_messages
  WHERE webhook_messages.phone = wa_contacts.phone
)
WHERE EXISTS (
  SELECT 1 FROM webhook_messages
  WHERE webhook_messages.phone = wa_contacts.phone
);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_last_inbound
  ON wa_contacts(last_inbound_at);
