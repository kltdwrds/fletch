-- vault: the schema as the lazy code of release m25.2 left it (no migrations table); generated once from the baselines.
CREATE TABLE browser_states (owner TEXT NOT NULL, site TEXT NOT NULL, ref TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (owner, site));
CREATE TABLE company_refs (ref TEXT PRIMARY KEY, connector TEXT NOT NULL);
CREATE TABLE credential_grants (nonce TEXT PRIMARY KEY, owner TEXT NOT NULL, ref TEXT NOT NULL, body TEXT NOT NULL, mac TEXT NOT NULL, issued_at INTEGER NOT NULL, revoked_at INTEGER, used_at INTEGER);
CREATE TABLE credential_hosts (owner TEXT NOT NULL, ref TEXT NOT NULL, host TEXT NOT NULL, methods TEXT NOT NULL, header TEXT NOT NULL, prefix TEXT NOT NULL, fills INTEGER NOT NULL, writer TEXT NOT NULL, via TEXT NOT NULL, created_at INTEGER NOT NULL, card TEXT, approved_at INTEGER, PRIMARY KEY (owner, ref, host));
CREATE TABLE egress_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ref TEXT NOT NULL, host TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, person TEXT NOT NULL, purpose TEXT NOT NULL, outcome TEXT NOT NULL, grant_nonce TEXT);
CREATE TABLE secrets (owner TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, permission TEXT NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER, used_at INTEGER, PRIMARY KEY (owner, ref));
CREATE TABLE session_fills (session TEXT NOT NULL, owner TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session, owner, ref));
CREATE TABLE surrogates (hash TEXT PRIMARY KEY, person TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vapid_key (id INTEGER PRIMARY KEY CHECK (id = 1), public TEXT NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE vault_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, owner TEXT NOT NULL, ref TEXT NOT NULL, event TEXT NOT NULL, by TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE vault_key (id INTEGER PRIMARY KEY CHECK (id = 1), blob TEXT NOT NULL, created_at INTEGER NOT NULL);
