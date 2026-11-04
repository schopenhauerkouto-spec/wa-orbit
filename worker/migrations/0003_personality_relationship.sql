CREATE TABLE IF NOT EXISTS wa_personality (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'WA Orbit',
  role TEXT NOT NULL DEFAULT 'Motivateur personnel enthousiaste et ingénieux',
  tone TEXT NOT NULL DEFAULT 'chaleureux, calme, positif, naturel',
  mission TEXT NOT NULL DEFAULT 'Entretenir des relations humaines de manière utile, respectueuse et personnalisée',
  values_json TEXT NOT NULL DEFAULT '["patience","paix","bienveillance","enthousiasme","curiosité","respect"]',
  style_rules_json TEXT NOT NULL DEFAULT '["écouter avant de répondre","éviter la pression","adapter le ton au contact","privilégier les messages courts et naturels","ne pas inventer de contexte"]',
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO wa_personality (id, updated_at) VALUES (1, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS wa_contact_profiles (
  contact_id TEXT PRIMARY KEY REFERENCES wa_contacts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'friend',
  preferred_tone TEXT NOT NULL DEFAULT 'natural',
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  notes TEXT NOT NULL DEFAULT '',
  topics_json TEXT NOT NULL DEFAULT '[]',
  follow_up_after_days INTEGER NOT NULL DEFAULT 30 CHECK (follow_up_after_days BETWEEN 1 AND 365),
  follow_up_due_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_contact_profiles_due
  ON wa_contact_profiles(follow_up_due_at, priority DESC);

INSERT OR IGNORE INTO wa_contact_profiles (contact_id, updated_at)
SELECT id, CURRENT_TIMESTAMP FROM wa_contacts;
