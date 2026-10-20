-- person: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, sha256 TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, cls TEXT NOT NULL,
  source TEXT NOT NULL, chat_id TEXT, message_id TEXT, notice_id TEXT, request_id TEXT, audience TEXT,
  status TEXT NOT NULL, code TEXT, kind TEXT, tree_path TEXT, pages INTEGER, caption TEXT, created_at INTEGER NOT NULL,
  CHECK (message_id IS NULL OR notice_id IS NULL));
CREATE TABLE browse_domains (domain TEXT PRIMARY KEY, engine TEXT, state TEXT NOT NULL, code TEXT, at INTEGER NOT NULL);
CREATE TABLE chats (id TEXT PRIMARY KEY, opened_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'side', title TEXT NOT NULL DEFAULT '', archived_at INTEGER, connected_at INTEGER);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL, text TEXT NOT NULL, scope TEXT NOT NULL, audience TEXT
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, tokenize = 'porter unicode61');
CREATE TABLE claims (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, salience INTEGER NOT NULL, confidence REAL NOT NULL,
  quote TEXT NOT NULL, speaker TEXT NOT NULL, supersedes TEXT, status TEXT NOT NULL,
  source_path TEXT NOT NULL, source_line INTEGER NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL,
  audience TEXT, created_at INTEGER NOT NULL, valid_until INTEGER
);
CREATE TABLE committed_effects (
  effect_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE daily_lines (
  date TEXT NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL, scope TEXT NOT NULL, audience TEXT,
  source TEXT NOT NULL, writer TEXT NOT NULL, dedupe TEXT UNIQUE, created_at INTEGER NOT NULL,
  rendered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, line)
);
CREATE TABLE delivery_dismissals (item_id TEXT PRIMARY KEY, category TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE delivery_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, chat TEXT, source TEXT NOT NULL, text TEXT NOT NULL, urgent INTEGER NOT NULL, state TEXT NOT NULL, hold_until INTEGER, code TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER, channels TEXT NOT NULL DEFAULT '[]', feedback TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER, disposition TEXT, retried TEXT NOT NULL DEFAULT '[]');
CREATE TABLE delivery_prefs (category TEXT PRIMARY KEY, stance TEXT NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE delivery_state (id INTEGER PRIMARY KEY CHECK (id = 1), zone TEXT NOT NULL, last_activity_at INTEGER, last_proactive_at INTEGER, mail INTEGER NOT NULL);
CREATE TABLE entities (
  kind TEXT NOT NULL, slug TEXT NOT NULL, display_name TEXT NOT NULL, summary TEXT NOT NULL,
  rank INTEGER NOT NULL, names TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (kind, slug)
);
CREATE TABLE files (
  path TEXT PRIMARY KEY, size INTEGER NOT NULL, sha256 TEXT NOT NULL, writer TEXT NOT NULL,
  updated_at INTEGER NOT NULL, body TEXT, spilled INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0
, media_type TEXT);
CREATE TABLE forget_plans (
  id TEXT PRIMARY KEY, claims TEXT NOT NULL, lines TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, confirmed_at INTEGER, executed_at INTEGER
, sites TEXT);
CREATE TABLE grant_uses (
  effect_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  used_at INTEGER
);
CREATE TABLE import_plans (id TEXT PRIMARY KEY, items TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE job_index (id TEXT PRIMARY KEY, noted_at INTEGER NOT NULL);
CREATE TABLE job_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE link_key (id INTEGER PRIMARY KEY CHECK (id = 1), key BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE loop_reconciliations (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, loop TEXT NOT NULL, lines INTEGER NOT NULL, from_mark TEXT, to_mark TEXT NOT NULL,
  added TEXT NOT NULL, superseded TEXT NOT NULL, dropped TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (run_id, seq)
);
CREATE TABLE loop_runs (run_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE loop_settings (loop TEXT PRIMARY KEY, enabled INTEGER NOT NULL, budget INTEGER NOT NULL);
CREATE TABLE mail_in (digest TEXT PRIMARY KEY, kind TEXT NOT NULL, chat TEXT NOT NULL, verified INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE mail_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE mail_tokens (token TEXT PRIMARY KEY, chat TEXT NOT NULL, counterpart TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE offboarding (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE personal_learning (id TEXT PRIMARY KEY, name TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE profile (email TEXT PRIMARY KEY, role TEXT NOT NULL, enrolled_by TEXT, at INTEGER NOT NULL);
CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, last_status INTEGER, last_at INTEGER);
CREATE TABLE shares (id TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE skill_seen (name TEXT PRIMARY KEY, hash TEXT NOT NULL, seen_at INTEGER NOT NULL);
CREATE TABLE vector_queue (row_id INTEGER PRIMARY KEY, op TEXT NOT NULL);
CREATE INDEX chunks_path ON chunks (path, line_start);
CREATE INDEX claims_source ON claims (source_path, source_line);
