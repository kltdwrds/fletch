-- ingress: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE deliveries (
  event_id TEXT NOT NULL,
  job TEXT NOT NULL,
  outcome TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (event_id, job)
);
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  via TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE TABLE rejects (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE socket (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  wanted INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER,
  connects INTEGER NOT NULL DEFAULT 0,
  drops INTEGER NOT NULL DEFAULT 0,
  last_code TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE source (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  id TEXT NOT NULL,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  secret TEXT,
  url TEXT,
  jobs TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
