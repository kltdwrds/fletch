// M25.3: named migrations, the dormant sweep, release-owned prefixes, the release channel. Fixtures are the schemas the lazy
// code of release m25.2 left (test/fixtures/db/release-m25.2/); a later release adds its own folder and keeps this one.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Company } from "../../packages/agent/src/objects/company.ts";
import { CompanyAuthority } from "../../packages/agent/src/company/authority.ts";
import { CompanyMembers } from "../../packages/agent/src/company/members.ts";
import { CompanyTeams } from "../../packages/agent/src/company/teams.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { Person } from "../../packages/agent/src/objects/person.ts";
import { Vault } from "../../packages/agent/src/objects/vault.ts";
import { COMPANY_MIGRATIONS, OBJECT_MIGRATIONS, type ObjectKind } from "../../packages/agent/src/migrations/catalog.ts";
import { migrate, migrationStatus, type Migration } from "../../packages/agent/src/migrations/engine.ts";
import { type Probe, sweepTenant } from "../../packages/agent/src/migrations/sweep.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, T0 } from "./support/authority-world.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/db/release-m25.2");
const fixture = (kind: string) => readFileSync(join(FIXTURES, `${kind}.sql`), "utf8");

/** A harness over a dormant object: the fixture's schema and rows, no migrations table, nothing constructed yet. */
function dormant<T extends object>(name: string, kind: ObjectKind, make: (ctx: unknown, env: unknown) => T, env: Record<string, unknown> = {}, seed?: (h: ObjectHarness<T>) => void) {
  const h = new ObjectHarness<T>(name, make, env);
  h.autoMigrate = false;
  h.db.exec(fixture(kind));
  seed?.(h);
  return h;
}
const names = <T extends object>(h: ObjectHarness<T>, kind: ObjectKind) => h.rows("SELECT name FROM migrations WHERE name LIKE ? ORDER BY name", `${kind}.%`).map((r) => String(r.name));
const columnsOf = <T extends object>(h: ObjectHarness<T>) => Object.fromEntries(h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%_fts%' AND name != 'sqlite_sequence' ORDER BY name").map((t) => [t.name, h.rows(`SELECT name FROM pragma_table_info('${t.name}') ORDER BY name`).map((c) => c.name)]));

describe("[M25.3] named migrations", () => {
  it("a migration applied twice is a no-op: the second run applies nothing and the record keeps its first time", () => {
    const h = new ObjectHarness("ledger-once", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), {});
    const list = OBJECT_MIGRATIONS.ledger;
    void h.instance;
    const first = h.rows("SELECT name, applied_at, release FROM migrations WHERE name LIKE 'ledger.%' ORDER BY name");
    expect(first.map((r) => r.name)).toEqual(list.map((m) => m.name).toSorted());
    expect(first.every((r) => typeof r.release === "string" && r.release.length > 0)).toBe(true);
    const again = h.instance as unknown as { ctx: { storage: never } };
    expect(again.ctx.storage).toBeDefined();
    expect(migrate(again.ctx.storage, list, () => 1)).toEqual({ applied: [] });
    expect(h.rows("SELECT name, applied_at, release FROM migrations WHERE name LIKE 'ledger.%' ORDER BY name")).toEqual(first);
  });

  it("a migration that fails leaves no record and none of its changes, and the next wake retries it", () => {
    const h = new ObjectHarness("flaky", (ctx) => ctx as { storage: never }, {});
    const storage = h.instance.storage;
    let broken = true;
    const list: Migration[] = [
      { name: "t.one", release: "m25.3", up: (sql) => void sql.exec("CREATE TABLE IF NOT EXISTS t_one (a INTEGER)") },
      { name: "t.two", release: "m25.3", up: (sql) => { sql.exec("CREATE TABLE IF NOT EXISTS t_two (a INTEGER)"); if (broken) throw new Error("boom"); } },
    ];
    expect(() => migrate(storage, list)).toThrow("boom");
    expect(h.rows("SELECT name FROM migrations WHERE name LIKE 't.%'").map((r) => r.name)).toEqual(["t.one"]);
    expect(h.rows("SELECT name FROM sqlite_master WHERE name = 't_two'")).toEqual([]);
    broken = false;
    expect(migrate(storage, list).applied).toEqual(["t.two"]);
  });

  it("a fixture from the older release migrates to the schema a fresh object has, keeping its rows", () => {
    for (const file of readdirSync(FIXTURES)) {
      const kind = file.replace(/\.sql$/, "") as ObjectKind;
      const old = dormant(`old-${kind}`, kind, (ctx) => ctx as { storage: never });
      const fresh = new ObjectHarness(`fresh-${kind}`, (ctx) => ctx as { storage: never }, {});
      fresh.autoMigrate = false;
      const before = columnsOf(old);
      migrate(old.instance.storage, OBJECT_MIGRATIONS[kind]);
      migrate(fresh.instance.storage, OBJECT_MIGRATIONS[kind]);
      const after = columnsOf(old);
      expect(after, kind).toEqual(columnsOf(fresh));
      for (const [table, cols] of Object.entries(before)) expect(after[table], `${kind}.${table}`).toEqual(cols);
      expect(migrationStatus(old.instance.storage, OBJECT_MIGRATIONS[kind]).behind).toEqual([]);
    }
  });

  it("an older store than the fixture gains its columns: a Ledger without cost_micros prices its rows, a memory without valid_until gains it", () => {
    const h = new ObjectHarness("ledger-pre-m5", (ctx) => ctx as { storage: never }, {});
    h.db.exec("CREATE TABLE model_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, person TEXT NOT NULL, run_id TEXT NOT NULL, route TEXT NOT NULL, model TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL, code TEXT, http_status INTEGER, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, reasoning_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, at INTEGER NOT NULL)");
    h.db.prepare("INSERT INTO model_calls (tenant, person, run_id, route, model, attempt, status, input_tokens, output_tokens, reasoning_tokens, cached_tokens, at) VALUES ('solo-sam', ?, 'r1', 'chat', 'unpriced-model', 1, 'ok', 10, 5, 0, 0, 1)").run(ada.email);
    migrate(h.instance.storage, OBJECT_MIGRATIONS.ledger);
    const cols = h.rows("SELECT name FROM pragma_table_info('model_calls')").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["cost_micros", "started_at", "first_token_at", "finished_at", "provider"]));
    expect(h.rows("SELECT person, started_at, provider FROM model_calls")).toEqual([{ person: ada.email, started_at: null, provider: null }]);
  });

  it("the stores create no tables of their own: no source file but the migrations' schema owners runs CREATE or ALTER TABLE", () => {
    const lazy = lazySchemaSites();
    expect(lazy).toEqual([]);
    expect(lazySchemaSites({ "planted.ts": 'storage.sql.exec("CREATE TABLE IF NOT EXISTS t (a INTEGER)");' })).toEqual(["planted.ts"]);
    expect(lazySchemaSites({ "planted.ts": "sql.exec(`ALTER TABLE t ADD COLUMN b TEXT`);" })).toEqual(["planted.ts"]);
  });

  it("every exported store schema is in the catalog: a new SCHEMA a list forgets fails here", () => {
    expect(unlistedSchemas()).toEqual([]);
    expect(unlistedSchemas({ "x/store.ts": "export const SCHEMA = `CREATE TABLE IF NOT EXISTS x (a INTEGER)`;" }, "")).toEqual(["x/store.ts"]);
  });

  it("the Company's own list creates the grants tables its authority uses", () => {
    // The regression: COMPANY_MIGRATIONS never included the grants schema, so a real Company object —
    // whose constructor runs only its own list — had no grants table, and the approval step for a
    // company-scoped card (jobs_enable) failed with "no such table: grants" on staging. The harness
    // runs HARNESS_MIGRATIONS (every list) against one storage, so it never showed.
    const h = new ObjectHarness("company-grants", (ctx) => ctx as { storage: never }, {});
    h.autoMigrate = false;
    const storage = h.instance.storage;
    migrate(storage, COMPANY_MIGRATIONS);
    const members = new CompanyMembers(storage, JSON.stringify([{ email: ada.email, role: "admin", name: "Ada" }]), () => T0);
    const teams = new CompanyTeams(storage, members, () => T0);
    const authority = new CompanyAuthority(storage, "solo-sam", members, teams, () => T0);
    const created = authority.createGrant(ada.email, {
      grantor: { kind: "company", id: "solo-sam" },
      grantee: { kind: "any-member" },
      subject: { kind: "action-kind", ref: "jobs.enable" },
      mode: "auto",
      created_from: "approval-card",
      constraints: {},
    });
    expect(created.ok).toBe(true);
    if (created.ok) expect(authority.snapshot().grants.map((g) => g.id)).toContain(created.grant.id);
  });
});

describe("[M25.3] the dormant sweep", () => {
  it("wakes every object of a tenant with its two members, migrates each from the older release, and keeps their data apart", async () => {
    const env = { TENANT_ID: "solo-sam", QYVR_ENV: "test" } as Record<string, unknown>;
    const person = (email: string) => dormant<Person>(`person-${email}`, "person", (ctx, e) => new Person(ctx as never, e as never), env, (h) => {
      h.db.prepare("INSERT INTO profile (email, role, enrolled_by, at) VALUES (?, 'member', NULL, 1)").run(email);
    });
    const people = new Map([[ada.email, person(ada.email)], [other.email, person(other.email)]]);
    const company = dormant("company", "company", (ctx, e) => new Company(ctx as never, e as never), env);
    const ledger = dormant("ledger", "ledger", (ctx, e) => new Ledger(ctx as never, e as never), env);
    const vault = dormant("vault", "vault", (ctx, e) => new Vault(ctx as never, e as never), env);
    for (const h of [company, ledger, vault, ...people.values()]) expect(h.rows("SELECT name FROM sqlite_master WHERE name = 'migrations'")).toEqual([]);

    const report = await sweepTenant({
      members: async () => [ada.email, other.email],
      company: () => (company.instance as Company).migrationProbe(),
      ledger: () => (ledger.instance as Ledger).migrationProbe(),
      vault: () => (vault.instance as Vault).migrationProbe(),
      person: async (email) => (await (people.get(email) as ObjectHarness<Person>).instance.platformCall({ op: "probe" })) as never,
      chat: async () => { throw new Error("no chats in this tenant"); },
      job: async () => { throw new Error("no jobs in this tenant"); },
    });
    expect(report.failed).toEqual([]);
    expect(report).toMatchObject({ ok: true, woken: 5, migrated: 5, behind: [], failed: [] });
    expect(report.applied).toBe(OBJECT_MIGRATIONS.company.length + OBJECT_MIGRATIONS.ledger.length + OBJECT_MIGRATIONS.vault.length + 2 * OBJECT_MIGRATIONS.person.length);
    expect(names(ledger, "ledger")).toEqual(OBJECT_MIGRATIONS.ledger.map((m) => m.name).toSorted());
    for (const [email, h] of people) {
      expect(names(h, "person")).toEqual(OBJECT_MIGRATIONS.person.map((m) => m.name).toSorted());
      expect(h.rows("SELECT email FROM profile").map((r) => r.email)).toEqual([email]);
    }
    // a second sweep finds nothing left to migrate
    const again = await sweepTenant({
      members: async () => [ada.email],
      company: () => (company.instance as Company).migrationProbe(),
      ledger: () => (ledger.instance as Ledger).migrationProbe(),
      vault: () => (vault.instance as Vault).migrationProbe(),
      person: async (email) => (await (people.get(email) as ObjectHarness<Person>).instance.platformCall({ op: "probe" })) as never,
      chat: async () => { throw new Error("none"); },
      job: async () => { throw new Error("none"); },
    });
    expect(again).toMatchObject({ ok: true, migrated: 0, applied: 0 });
  });

  it("an object behind or silent is reported, never counted as migrated", async () => {
    const probe = (o: string, behind: string[] = []): Probe => ({ object: o, applied: 0, behind });
    const base = { members: async () => [ada.email, other.email], company: async () => probe("company"), ledger: async () => probe("ledger"), vault: async () => probe("vault"), chat: async () => probe("chat"), job: async () => probe("job") };
    const behind = await sweepTenant({ ...base, person: async (e) => ({ ...probe("person", e === other.email ? ["person.skill-seen"] : []), chats: [], jobs: [] }) });
    expect(behind).toMatchObject({ ok: false, code: "MIGRATION_BEHIND", behind: [{ object: `person:${other.email}`, names: ["person.skill-seen"] }] });
    const silent = await sweepTenant({ ...base, person: async (e) => { if (e === ada.email) throw new Error("EVICTED"); return { ...probe("person"), chats: ["c1"], jobs: [] }; }, chat: async () => { throw new Error("chat would not wake"); } });
    expect(silent).toMatchObject({ ok: false, code: "MIGRATION_SWEEP_FAILED" });
    expect(silent.failed.map((f) => f.object)).toEqual([`person:${ada.email}`, "chat:c1"]);
    expect(silent.woken).toBe(4);
  });
});

function sourceFiles(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith(".ts")) out[p.slice(SRC.length + 1)] = readFileSync(p, "utf8");
  }
  return out;
}
const SRC = join(import.meta.dirname, "../../packages/agent/src");
const OWNERS = /^(migrations\/(catalog|engine)\.ts)$/;

/** Files that run CREATE or ALTER TABLE from an `exec(` call outside the migrations' own modules. */
function lazySchemaSites(files: Record<string, string> = sourceFiles(SRC)): string[] {
  return Object.entries(files).filter(([f, text]) => !OWNERS.test(f) && /\.exec\(\s*["'`][^"'`]*\b(CREATE|ALTER)\s+(VIRTUAL\s+)?TABLE/i.test(text)).map(([f]) => f);
}

/** Files that export a schema constant the catalog does not import. */
function unlistedSchemas(files: Record<string, string> = sourceFiles(SRC), catalog = readFileSync(join(SRC, "migrations/catalog.ts"), "utf8")): string[] {
  return Object.entries(files).filter(([f, text]) => /export const (SCHEMA|MEMORY_SCHEMA)\s*=/.test(text) && !catalog.includes(`/${f.replace(/\.ts$/, "")}.ts"`) && !catalog.includes(`"../${f}"`)).map(([f]) => f);
}

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
