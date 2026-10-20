-- job: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE event_evals (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  open INTEGER NOT NULL,
  why TEXT NOT NULL,
  observed TEXT NOT NULL,
  run_id TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE job (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  def TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  status TEXT NOT NULL,
  status_code TEXT,
  status_reason TEXT,
  gate_state TEXT NOT NULL DEFAULT '{}',
  last_slot INTEGER,
  failures INTEGER NOT NULL DEFAULT 0,
  backoff_until INTEGER,
  next_probe INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  ticks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  chat TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  last_code TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  step INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  timeout_at INTEGER,
  retry_at INTEGER,
  observed TEXT NOT NULL DEFAULT '{}',
  signal TEXT,
  code TEXT,
  reason TEXT,
  next_probe INTEGER,
  ledger_synced INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (job_id, scheduled_for)
);
CREATE TABLE steps (
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  output TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, step)
);
CREATE TABLE tool_calls (
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  n INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  ok INTEGER NOT NULL,
  code TEXT,
  PRIMARY KEY (run_id, step, n)
);
