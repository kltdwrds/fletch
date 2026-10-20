// The Chat object's turns, transcript and outbox, as they stood at M25.2; later changes are named migrations (migrations/catalog.ts).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  compacted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  status TEXT NOT NULL,
  code TEXT,
  reason TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  delivered_at INTEGER
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  card TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  checkpoint_seq INTEGER NOT NULL,
  first_kept_seq INTEGER NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER,
  trigger TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  code TEXT,
  reason TEXT
);`;
