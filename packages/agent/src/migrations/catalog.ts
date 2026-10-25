// Every object's migrations, in the order they were made (M25.3). The lazy `CREATE TABLE IF NOT EXISTS` and guarded
// `ALTER TABLE` calls the stores used to run on first use are named here and run by the object's constructor. Append
// only: a released name is never edited or reordered. Baselines carry the release they were folded in at (`m25.2`, the
// last release with lazy schema); a later change carries its own.
import { SCHEMA as ATTACHMENTS } from "../attachments/store.ts";
import { COLUMNS as DELIVERY_COLUMNS, SCHEMA as DELIVERY } from "../delivery/service.ts";
import { SCHEMA as FILES } from "../files/store.ts";
import { SCHEMA as LINKS } from "../files/links.ts";
import { SCHEMA as CARDS } from "../chat/cards.ts";
import { SCHEMA as CHAT } from "../chat/schema.ts";
import { SCHEMA as MAILBOX } from "../chat/mailbox.ts";
import { SCHEMA as MESSAGE_ACTIONS } from "../chat/message-actions.ts";
import { SCHEMA as PROJECTIONS } from "../chat/projection.ts";
import { SCHEMA as AUTHORITY } from "../company/authority.ts";
import { SCHEMA as CONNECTORS } from "../company/connectors.ts";
import { SCHEMA as INSTRUCTIONS } from "../company/instructions.ts";
import { SCHEMA as MEMBERS } from "../company/members.ts";
import { SCHEMA as MIRROR } from "../company/mirror.ts";
import { SCHEMA as ONBOARDING } from "../company/onboarding.ts";
import { SCHEMA as SETTINGS } from "../company/settings.ts";
import { SCHEMA as TEAMS } from "../company/teams.ts";
import { SCHEMA as GRANTS } from "../grants/store.ts";
import { SCHEMA as INGRESS } from "../ingress/store.ts";
import { SCHEMA as JOB_EVENTS } from "../jobs/events.ts";
import { SCHEMA as JOBS } from "../jobs/schema.ts";
import { SCHEMA as LADDER } from "../learning/ladder.ts";
import { SCHEMA as PERSONAL_LEARNING } from "../learning/personal.ts";
import { SCHEMA as IMPORT } from "../lifecycle/import.ts";
import { SCHEMA as COMPANY_LOOPS } from "../loops/company.ts";
import { SCHEMA as PERSONAL_LOOPS } from "../loops/personal.ts";
import { SCHEMA as COMPANY_MEMORY } from "../memory/company.ts";
import { MEMORY_SCHEMA } from "../memory/store.ts";
import { SCHEMA as LEDGER } from "../ledger/schema.ts";
import { costMicros, isBudgetKey } from "../ledger/budget.ts";
import { COLUMNS as CHAT_COLUMNS, SCHEMA as PERSON_CHATS } from "../person/chats.ts";
import { SCHEMA as JOB_INDEX } from "../person/job-index.ts";
import { SCHEMA as MAIL } from "../person/mail.ts";
import { SCHEMA as PROFILE } from "../person/profile.ts";
import { SCHEMA as SKILL_SEEN } from "../skills/seen.ts";
import { SCHEMA as SUBAGENT_STORE } from "../subagents/store.ts";
import { SCHEMA as SUBAGENT_TRANSCRIPT } from "../subagents/run.ts";
import { PASSKEY_SCHEMA } from "@qyvr/host-cloudflare";
import { addColumns, type Migration, migrateInConstructor, migrationStatus, schema } from "./engine.ts";

const B = "m25.2";
const columns = (o: Array<[string, string]>) => Object.fromEntries(o);

/** One loop table pair per owner: settings and finished runs (`loops/registry.ts`). */
const LOOP_SETTINGS = schema("loop-settings", B, `CREATE TABLE IF NOT EXISTS loop_settings (loop TEXT PRIMARY KEY, enabled INTEGER NOT NULL, budget INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS loop_runs (run_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, at INTEGER NOT NULL);`);

export const PERSON_MIGRATIONS: readonly Migration[] = [
  schema("person.memory", B, MEMORY_SCHEMA),
  addColumns("person.memory-claims-valid-until", "m15.2", "claims", { valid_until: "INTEGER" }),
  addColumns("person.memory-forget-plans-sites", "m24.3", "forget_plans", { sites: "TEXT" }),
  schema("person.chats", B, PERSON_CHATS),
  addColumns("person.chats-kind-title-archive", "m17.1", "chats", columns(CHAT_COLUMNS)),
  schema("person.mail", B, MAIL),
  schema("person.profile", B, PROFILE),
  schema("person.job-index", B, JOB_INDEX),
  schema("person.learning", B, PERSONAL_LEARNING),
  schema("person.import", B, IMPORT),
  schema("person.offboarding", B, "CREATE TABLE IF NOT EXISTS offboarding (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
  schema("person.loop-reconciliations", B, PERSONAL_LOOPS),
  { ...LOOP_SETTINGS, name: "person.loop-settings" },
  schema("person.delivery", B, DELIVERY),
  addColumns("person.delivery-attempts", "m15.2", "delivery_items", columns(DELIVERY_COLUMNS)),
  { name: "person.delivery-state-row", release: B, up: (sql) => void sql.exec("INSERT INTO delivery_state (id, zone, mail) VALUES (1, 'UTC', 1) ON CONFLICT(id) DO NOTHING") },
  schema("person.files", B, FILES),
  addColumns("person.files-pinned", "m23.4", "files", { pinned: "INTEGER NOT NULL DEFAULT 0" }),
  addColumns("person.files-media-type", "m24.3", "files", { media_type: "TEXT" }),
  schema("person.links", B, LINKS),
  schema("person.attachments", B, ATTACHMENTS),
  schema("person.grants", B, GRANTS),
  schema("person.skill-seen", "m25.3", SKILL_SEEN),
  schema("person.browse", B, "CREATE TABLE IF NOT EXISTS browse_domains (domain TEXT PRIMARY KEY, engine TEXT, state TEXT NOT NULL, code TEXT, at INTEGER NOT NULL)"),
];

export const COMPANY_MIGRATIONS: readonly Migration[] = [
  schema("company.authority", B, AUTHORITY),
  schema("company.grants", B, GRANTS),
  schema("company.connectors", B, CONNECTORS),
  schema("company.instructions", B, INSTRUCTIONS),
  schema("company.members", B, MEMBERS),
  schema("company.mirror", B, MIRROR),
  schema("company.onboarding", B, ONBOARDING),
  schema("company.settings", B, SETTINGS),
  schema("company.teams", B, TEAMS),
  schema("company.loops", B, COMPANY_LOOPS),
  { ...LOOP_SETTINGS, name: "company.loop-settings" },
  schema("company.memory", B, COMPANY_MEMORY),
  schema("company.promotions", B, LADDER),
  {
    // Budgets in dollars (M28.1): the stored token caps go, unconverted, since a value an admin set cannot be told from the
    // product defaults the old view pushed; a dollar cap already stored stays.
    name: "company.settings-budgets-dollars",
    release: "m28.1",
    up(sql) {
      const raw = sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'budgets'").toArray()[0]?.value;
      if (raw === undefined) return;
      const kept = Object.fromEntries(Object.entries(JSON.parse(raw) as Record<string, unknown>).filter(([k]) => isBudgetKey(k)));
      if (Object.keys(kept).length) sql.exec("UPDATE settings SET value = ? WHERE key = 'budgets'", JSON.stringify(kept));
      else sql.exec("DELETE FROM settings WHERE key = 'budgets'");
    },
  },
  // Passkeys, sessions and recovery codes of the self-host login (F1); `runLoginCall` also ensures them, idempotently.
  schema("f1-passkeys", "f1", PASSKEY_SCHEMA),
];

export const CHAT_MIGRATIONS: readonly Migration[] = [
  schema("chat.store", B, CHAT),
  addColumns("chat.turns-reason", "m17.1", "turns", { reason: "TEXT" }),
  addColumns("chat.compactions-outcome", "m24.2", "compactions", { status: "TEXT NOT NULL DEFAULT 'done'", code: "TEXT", reason: "TEXT" }),
  schema("chat.projections", B, PROJECTIONS),
  schema("chat.mailbox", B, MAILBOX),
  schema("chat.cards", B, CARDS),
  addColumns("chat.cards-detail", "m18.2", "cards", { detail: "TEXT" }),
  schema("chat.subagents", B, SUBAGENT_STORE),
  schema("chat.message-actions", "m29.4", MESSAGE_ACTIONS),
];

export const JOB_MIGRATIONS: readonly Migration[] = [schema("job.store", B, JOBS), schema("job.events", B, JOB_EVENTS)];
export const INGRESS_MIGRATIONS: readonly Migration[] = [schema("ingress.store", B, INGRESS)];
export const SUBAGENT_MIGRATIONS: readonly Migration[] = [schema("subagent.transcript", B, SUBAGENT_TRANSCRIPT)];

export const VAULT_MIGRATIONS: readonly Migration[] = [
  // M3.2's `credentials` and `browse_fills` were keyed without an owner; their rows were staging seeds and are dropped.
  schema("vault.drop-unkeyed", B, "DROP TABLE IF EXISTS credentials; DROP TABLE IF EXISTS browse_fills;"),
  schema("vault.tables", B, `
CREATE TABLE IF NOT EXISTS vault_key (id INTEGER PRIMARY KEY CHECK (id = 1), blob TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (owner TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, permission TEXT NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER, PRIMARY KEY (owner, ref));
CREATE TABLE IF NOT EXISTS credential_hosts (owner TEXT NOT NULL, ref TEXT NOT NULL, host TEXT NOT NULL, methods TEXT NOT NULL, header TEXT NOT NULL, prefix TEXT NOT NULL, fills INTEGER NOT NULL, writer TEXT NOT NULL, via TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (owner, ref, host));
CREATE TABLE IF NOT EXISTS credential_grants (nonce TEXT PRIMARY KEY, owner TEXT NOT NULL, ref TEXT NOT NULL, body TEXT NOT NULL, mac TEXT NOT NULL, issued_at INTEGER NOT NULL, revoked_at INTEGER, used_at INTEGER);
CREATE TABLE IF NOT EXISTS vault_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, owner TEXT NOT NULL, ref TEXT NOT NULL, event TEXT NOT NULL, by TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS egress_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ref TEXT NOT NULL, host TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, person TEXT NOT NULL, purpose TEXT NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_fills (session TEXT NOT NULL, owner TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session, owner, ref));
CREATE TABLE IF NOT EXISTS company_refs (ref TEXT PRIMARY KEY, connector TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS surrogates (hash TEXT PRIMARY KEY, person TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL);`),
  addColumns("vault.egress-audit-grant-nonce", "m13", "egress_audit", { grant_nonce: "TEXT" }),
  addColumns("vault.secrets-used-at", "m13", "secrets", { used_at: "INTEGER" }),
  addColumns("vault.credential-hosts-card", "m25.1", "credential_hosts", { card: "TEXT", approved_at: "INTEGER" }),
  schema("vault.vapid", B, "CREATE TABLE IF NOT EXISTS vapid_key (id INTEGER PRIMARY KEY CHECK (id = 1), public TEXT NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL, created_at INTEGER NOT NULL)"),
  schema("vault.browser-states", B, "CREATE TABLE IF NOT EXISTS browser_states (owner TEXT NOT NULL, site TEXT NOT NULL, ref TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (owner, site))"),
];

export const LEDGER_MIGRATIONS: readonly Migration[] = [
  schema("ledger.tables", B, LEDGER),
  {
    // `cost_micros` arrived at M5.1 inside `CREATE TABLE IF NOT EXISTS`, which left a Ledger made before it without the column;
    // each older row is priced from its own model and tokens as `record` prices a new one (a model with no price stays 0).
    name: "ledger.model-calls-cost",
    release: "m5.1",
    up(sql) {
      if (sql.exec("SELECT name FROM pragma_table_info('model_calls') WHERE name = 'cost_micros'").toArray().length) return;
      sql.exec("ALTER TABLE model_calls ADD COLUMN cost_micros INTEGER NOT NULL DEFAULT 0");
      for (const r of sql.exec<{ id: number; model: string; input_tokens: number; output_tokens: number; cached_tokens: number }>("SELECT id, model, input_tokens, output_tokens, cached_tokens FROM model_calls").toArray()) {
        const cost = costMicros(r.model, { input: r.input_tokens, output: r.output_tokens, cached: r.cached_tokens });
        if (cost.micros) sql.exec("UPDATE model_calls SET cost_micros = ? WHERE id = ?", cost.micros, r.id);
      }
    },
  },
  // The three timing columns (M18.3) stay null on older rows: a call made before them was not timed, and is never shown as instant.
  addColumns("ledger.model-calls-timings", "m18.3", "model_calls", { started_at: "INTEGER", first_token_at: "INTEGER", finished_at: "INTEGER" }),
  addColumns("ledger.model-calls-provider", "m22.1", "model_calls", { provider: "TEXT" }),
  schema("ledger.browser-usage", "m25.4", "CREATE TABLE IF NOT EXISTS browser_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, person TEXT NOT NULL, run_id TEXT NOT NULL, op TEXT NOT NULL, ms INTEGER NOT NULL, at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS browser_usage_run ON browser_usage (run_id)"),
  // Budgets in dollars (M28.1): the Ledger's stored token caps go with the Company's; any key that is not a dollar cap is dropped.
  { name: "ledger.budgets-dollars", release: "m28.1", up: (sql) => void sql.exec("DELETE FROM budgets WHERE key NOT IN ('tenantDailyMicros', 'personDailyMicros')") },
];

/** The objects a tenant's sweep walks, by kind, with the migrations each must have applied. */
export const OBJECT_MIGRATIONS = {
  person: PERSON_MIGRATIONS,
  company: COMPANY_MIGRATIONS,
  chat: CHAT_MIGRATIONS,
  job: JOB_MIGRATIONS,
  ingress: INGRESS_MIGRATIONS,
  vault: VAULT_MIGRATIONS,
  ledger: LEDGER_MIGRATIONS,
  subagent: SUBAGENT_MIGRATIONS,
} as const;

export type ObjectKind = keyof typeof OBJECT_MIGRATIONS;

/** An object's constructor line: `private readonly schema = migrateObject(this.ctx, "person");` */
export function migrateObject(ctx: Parameters<typeof migrateInConstructor>[0], kind: ObjectKind): ObjectSchema {
  return { kind, held: migrateInConstructor(ctx, OBJECT_MIGRATIONS[kind]) };
}

/** What an object knows of its schema: its kind and the names its last wake applied. */
export interface ObjectSchema {
  kind: ObjectKind;
  held: { applied: string[] };
}

/** The sweep's answer from one woken object: what this wake applied, and what its list still has unapplied. */
export function probeObject(storage: Pick<DurableObjectStorage, "sql">, schema: ObjectSchema): { object: string; applied: number; behind: string[] } {
  // What a wake applied is reported once: the next probe of the same instance has applied nothing new.
  const applied = schema.held.applied.length;
  schema.held.applied = [];
  return { object: schema.kind, applied, behind: migrationStatus(storage, OBJECT_MIGRATIONS[schema.kind]).behind };
}

/**
 * The lists of the objects whose tables do not clash, for a test harness whose one storage stands in for any of them. Chat and
 * Job both own an `outbox` of different shapes, so their stores migrate their own list (and the real objects do too).
 */
export const HARNESS_MIGRATIONS: readonly Migration[] = Object.entries(OBJECT_MIGRATIONS).filter(([k]) => k !== "chat" && k !== "job").flatMap(([, l]) => l);
