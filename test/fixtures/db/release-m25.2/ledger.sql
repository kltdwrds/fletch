-- ledger: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE budgets (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE company_policy (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE job_runs (
  person TEXT NOT NULL,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person, run_id)
);
CREATE TABLE journal (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  at INTEGER NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant TEXT NOT NULL,
  person TEXT NOT NULL,
  run_id TEXT NOT NULL,
  route TEXT NOT NULL,
  model TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  code TEXT,
  http_status INTEGER,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  started_at INTEGER,
  first_token_at INTEGER,
  finished_at INTEGER,
  provider TEXT
);
CREATE TABLE rollups (day TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE turn_ends (
  person TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  steps INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, turn_id)
);
