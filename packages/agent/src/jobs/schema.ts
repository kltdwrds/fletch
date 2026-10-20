// The Job object's job, runs, steps and outbox, as they stood at M25.2; later changes are named migrations (migrations/catalog.ts).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS job (
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
CREATE TABLE IF NOT EXISTS runs (
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
CREATE TABLE IF NOT EXISTS steps (
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
CREATE TABLE IF NOT EXISTS outbox (
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
CREATE TABLE IF NOT EXISTS tool_calls (
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  n INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  ok INTEGER NOT NULL,
  code TEXT,
  PRIMARY KEY (run_id, step, n)
);`;
