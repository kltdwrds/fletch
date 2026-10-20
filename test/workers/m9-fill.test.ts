// Credential fill at the egress module (M9): the policy that decides which page may take which
// credential, the audit row each resolution writes, and the redaction of a failure's reason. Run on
// the real `VaultCore` with the dispatcher's real key service, as M3.2's suite does.
import { describe, expect, it } from "vitest";
import { VaultCore } from "../../packages/agent/src/vault/core.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { seededToken } from "../support/vendors/index.ts";
import { FILL_ENTRY, LOGIN_HOST, LOGIN_REF } from "./support/browse-world.ts";
import { asPerson, keysFor, testMasterKey } from "./support/vault-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;

function vault(inject: (session: string, selector: string, value: string) => Promise<void>) {
  const typed: string[] = [];
  const inner = keysFor(ada.company, testMasterKey());
  const locked = { on: false };
  const keys = { wrap: (raw: Uint8Array) => inner.wrap(raw), unwrap: async (blob: string) => (locked.on ? { ok: false as const, code: "KEY_UNAVAILABLE", reason: "the master key is not available" } : inner.unwrap(blob)) } as typeof inner;
  const h = new ObjectHarness("vault-fill", (ctx) => new VaultCore(ctx as never, { tenant: ada.company, keys, fetch: async () => new Response(""), now: () => 1_760_000_000_000, inject: async (s, sel, v) => { typed.push(v); await inject(s, sel, v); } }), {});
  return { h, typed, locked, v: () => h.instance };
}
const req = (over: Partial<{ url: string; ref: string }> = {}) => ({ session: "s1", url: `https://${LOGIN_HOST}/signin`, selector: "#pw", ref: LOGIN_REF, ...over });
const ctx = { person: ada.email, purpose: "browse_fill" };

describe("[M9] the egress module's fill", () => {
  it("types into a page of a host that lists the reference, writes an audit row, and returns no value", async () => {
    const token = seededToken();
    const { v, typed } = vault(async () => {});
    expect(await v().capture({ ref: LOGIN_REF, value: token, kind: "login", hosts: [FILL_ENTRY] }, asPerson(ada.email))).toMatchObject({ ok: true });
    const r = await v().fill(req(), ctx);
    expect(r).toEqual({ ok: true, host: LOGIN_HOST });
    expect(typed).toEqual([token]);
    expect(v().audit()).toMatchObject([{ ref: LOGIN_REF, host: LOGIN_HOST, method: "FILL", path: "/signin", outcome: "resolved" }]);
    expect(JSON.stringify([r, v().audit()])).not.toContain(token);
  });

  it("refuses a host that is not listed, a plain-http page, a reference the host does not list, and a missing credential, typing nothing", async () => {
    const token = seededToken();
    const { v, typed } = vault(async () => {});
    await v().capture({ ref: LOGIN_REF, value: token, kind: "login", hosts: [FILL_ENTRY] }, asPerson(ada.email));
    expect(await v().fill(req({ url: "https://evil.fixture.example/signin" }), ctx)).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(await v().fill(req({ url: `http://${LOGIN_HOST}/signin` }), ctx)).toMatchObject({ ok: false, code: "EGRESS_SCHEME_DENIED" });
    // A saved credential registered for another host only (M13's registry).
    await v().capture({ ref: "cred://github", value: seededToken(), hosts: ["api.github.com"] }, asPerson(ada.email));
    expect(await v().fill(req({ ref: "cred://github" }), ctx)).toMatchObject({ ok: false, code: "EGRESS_CRED_HOST_DENIED" });
    expect(await v().fill(req({ ref: "not-a-reference" }), ctx)).toMatchObject({ ok: false, code: "EGRESS_CRED_UNKNOWN" });
    expect(typed).toEqual([]);
    expect(v().audit()).toEqual([]);
    // Listed for the host but never stored: the resolution is refused and the refusal is audited.
    const fresh = vault(async () => {});
    expect(fresh.v()).toBeDefined(); // builds the schema
    fresh.h.db.exec(`INSERT INTO credential_hosts (owner, ref, host, methods, header, prefix, fills, writer, via, created_at) VALUES ('${ada.email}', '${LOGIN_REF}', '${LOGIN_HOST}', '[]', 'authorization', '', 1, '${ada.email}', 'settings', 0)`);
    expect(await fresh.v().fill(req(), ctx)).toMatchObject({ ok: false, code: "EGRESS_CRED_UNKNOWN" });
    expect(fresh.v().audit()).toMatchObject([{ outcome: "EGRESS_CRED_UNKNOWN" }]);
  });

  it("a credential bound to another host is not typed into this one", async () => {
    const { v, typed } = vault(async () => {});
    // `put` binds only to hosts that list the reference; a vault row bound elsewhere cannot be made.
    expect(await v().capture({ ref: LOGIN_REF, value: seededToken(), hosts: [{ ...FILL_ENTRY, host: "printer.local" }] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_HOST_PRIVATE" });
    expect(typed).toEqual([]);
  });

  it("a browser failure's reason is redacted of the value before it leaves the Vault", async () => {
    const token = seededToken();
    const { v } = vault(async (_s, _sel, value) => {
      throw new Error(`BROWSE_FIELD_NOT_FOUND: could not type ${value}`);
    });
    await v().capture({ ref: LOGIN_REF, value: token, kind: "login", hosts: [FILL_ENTRY] }, asPerson(ada.email));
    const r = await v().fill(req(), ctx);
    expect(r).toMatchObject({ ok: false, code: "EGRESS_FILL_FAILED", reason: "BROWSE_FIELD_NOT_FOUND: could not type [redacted cred://fixture-login]" });
    expect(v().audit()).toMatchObject([{ outcome: "EGRESS_FILL_FAILED" }]);
  });

  it("scrub replaces a typed value in a session's text and fails closed when the value cannot be opened", async () => {
    const token = seededToken();
    const { v, h, locked } = vault(async () => {});
    await v().capture({ ref: LOGIN_REF, value: token, kind: "login", hosts: [FILL_ENTRY] }, asPerson(ada.email));
    await v().fill(req(), ctx);
    expect(await v().scrub("s1", `Hello ${token}, welcome`)).toBe("Hello [redacted cred://fixture-login], welcome");
    // Another session typed nothing: its text is returned as it is.
    expect(await v().scrub("s2", `Hello ${token}`)).toBe(`Hello ${token}`);
    // Locked: a new instance cannot unwrap the key, so the text is not returned at all.
    locked.on = true;
    h.evict();
    await expect(v().scrub("s1", `Hello ${token}`)).rejects.toThrow(/^EGRESS_VAULT_LOCKED:/);
  });
});
