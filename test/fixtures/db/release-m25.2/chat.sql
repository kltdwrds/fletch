-- chat: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  decision TEXT NOT NULL,
  simulated INTEGER NOT NULL,
  flag TEXT,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  choice TEXT,
  decided_by TEXT,
  decided_at INTEGER,
  grant_id TEXT,
  outcome TEXT,
  created_at INTEGER NOT NULL,
  detail TEXT
);
CREATE TABLE chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE compactions (
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
);
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  card TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE mailbox (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  person TEXT NOT NULL,
  body TEXT NOT NULL,
  time_zone TEXT,
  state TEXT NOT NULL,
  turn_id TEXT,
  delivery TEXT,
  seq INTEGER,
  accepted_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  compacted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  delivered_at INTEGER
);
CREATE TABLE projections (turn_id TEXT PRIMARY KEY, blocks TEXT NOT NULL, hash TEXT NOT NULL, transcript_length INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE subagent_groups (
  grp TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  person TEXT NOT NULL,
  handed_off_at INTEGER
);
CREATE TABLE subagents (
  id TEXT PRIMARY KEY,
  grp TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  parent TEXT NOT NULL,
  role TEXT NOT NULL,
  depth INTEGER NOT NULL,
  person TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  code TEXT,
  verdict TEXT,
  verdict_reason TEXT,
  refusals TEXT NOT NULL DEFAULT '[]',
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE turns (
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
CREATE UNIQUE INDEX mailbox_message_id ON mailbox (message_id);
