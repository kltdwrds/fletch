-- company: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE company_connectors (id TEXT PRIMARY KEY, hosts TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE company_loop_marks (loop TEXT PRIMARY KEY, mark INTEGER NOT NULL);
CREATE TABLE company_loop_reconciliations (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, loop TEXT NOT NULL, lines INTEGER NOT NULL, from_mark INTEGER NOT NULL, to_mark INTEGER NOT NULL,
  added TEXT NOT NULL, superseded TEXT NOT NULL, dropped TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (run_id, seq)
);
CREATE TABLE company_loop_schedule (loop TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
CREATE TABLE cost_reports (month TEXT PRIMARY KEY, body TEXT NOT NULL, run_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE departures (email TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE disabled_agents (email TEXT PRIMARY KEY, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE instructions (version INTEGER PRIMARY KEY, text TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE loop_runs (run_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE loop_settings (loop TEXT PRIMARY KEY, enabled INTEGER NOT NULL, budget INTEGER NOT NULL);
CREATE TABLE members (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  invited_by TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE mirror_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, by TEXT NOT NULL, ok INTEGER NOT NULL, code TEXT, collection TEXT, documents INTEGER NOT NULL);
CREATE TABLE onboarding_draft (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, citation TEXT, decided_by TEXT, decided_at INTEGER);
CREATE TABLE onboarding_steps (step TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, by TEXT, at INTEGER NOT NULL);
CREATE TABLE policies (id TEXT PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE promotions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, proposer TEXT NOT NULL, origin TEXT NOT NULL,
  name TEXT, artifact TEXT NOT NULL, status TEXT NOT NULL, code TEXT, reason TEXT,
  decided_by TEXT, merged_as TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE scope_claims (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, source_path TEXT NOT NULL, source_line INTEGER NOT NULL,
  supersedes TEXT, status TEXT NOT NULL, writer TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE scope_fts USING fts5(text, tokenize = 'porter unicode61');
CREATE TABLE scope_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, date TEXT NOT NULL, line INTEGER NOT NULL,
  text TEXT NOT NULL, writer TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE (scope, date, line)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE team_members (team TEXT NOT NULL, email TEXT NOT NULL, added_by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (team, email));
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE vector_queue (row_id INTEGER PRIMARY KEY, op TEXT NOT NULL);
