CREATE TABLE IF NOT EXISTS maps (
  pin TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS maps_expires_at_idx ON maps (expires_at);
