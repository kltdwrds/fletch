// F36 (P9 deltas 6 and 8): a disconnect asked in chat and a mailed code's use are actions of fresh-card kinds. The
// model's call raises a card and does nothing else; a colleague cannot decide it and no standing grant can cover the
// kind; Sam's press, once, revokes the key with every grant that names it (keeping its audit rows), or approves the
// one-shot fill for the code. A company connector's removal ends its grants and writes its `revoked` row. Run on the
// P9 tier-1 world: Sam's real chats, gate and `Person`, the tenant's real `VaultCore`; Pat is the fixture's second member.
import { afterEach, describe, expect, it } from "vitest";
import { FRESH_CARD_KINDS } from "../../packages/agent/src/grants/engine.ts";
import { WHAT_REMAINS } from "../../packages/agent/src/vault/connections.ts";
import { call, load } from "../evals/p3-delegation/runs.ts";
import { asSam, exampleKey, P9Tier1World, pat, sam } from "../evals/p9-connectors/harness.ts";
import { API_HOST, API_REF, LOGIN_HOST, LOGIN_REF, PROBE_API } from "../evals/p9-connectors/world.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { seededToken } from "../support/vendors/index.ts";

async function world(script: FakeStep[]) {
  const w = new P9Tier1World({ script });
  await w.open();
  return w;
}
const say = (w: P9Tier1World, text: string) => w.play({ kind: "event", name: "prompt", payload: { text } });
const decide = async (w: P9Tier1World, as: string, id: string, choice: string) => {
  const r = await w.w.http(as, "POST", `/chats/${w.chatId("c1")}/cards/decide`, { ids: [id], choice });
  await w.engine("c1").settled();
  return r;
};
const standing = (w: P9Tier1World, kind: string) => w.w.http(sam.email, "POST", "/api/grants", { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: kind }, mode: "auto", created_from: "chat-confirmation", constraints: {} });
const naming = { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "fixture.create" }, mode: "auto", constraints: { resources: ["credential:example-api"] } };
/** The chat's stored messages as text: tool results and the notes a decided card leaves. */
const transcript = (w: P9Tier1World) => w.w.chats.harness(w.chatId("c1")).rows("SELECT body FROM messages ORDER BY seq").map((r) => String(r.body)).join("\n");
/** The grants still in force: neither revoked nor a spent one-shot (the card's own approval is one). */
const live = (w: P9Tier1World) => w.w.host(sam.email).authority.all().filter((g) => g.revoked_at === undefined && !(g.one_shot && g.used_at !== undefined)).map((g) => g.subject.ref);

/** Sam's key with one credential grant, a grant naming it, another grant that does not, and one audit row. */
async function seedKey(w: P9Tier1World) {
  await w.vault().capture(exampleKey(), asSam());
  await w.vault().issueGrant({ ref: API_REF, hosts: [API_HOST], methods: ["GET"], oneShot: true, expiresInMs: 300_000 }, asSam("settings"));
  await w.w.grant(sam.email, naming);
  await w.w.grant(sam.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "calendar.create" }, mode: "auto" });
  await w.vault().egress({ url: PROBE_API, method: "GET", headers: [["authorization", `Bearer ${API_REF}`]] }, { person: sam.email, purpose: "fixture_read" });
}

describe("[F36] a disconnect asked in chat is the person's card", () => {
  it("the model's call raises a card and revokes nothing; Pat cannot decide it and no standing grant covers the kind", async () => {
    const w = await world([load("credentials"), call("credential_revoke", { ref: API_REF }, "r1"), { text: "It waits on your card." }]);
    await seedKey(w);
    await say(w, "Disconnect my Example API key.");
    const [card] = w.cards("c1");
    expect(card).toMatchObject({ tool: "credential_revoke", state: "pending" });
    const shown = w.w.cardsOf(sam.email)[0];
    expect(shown?.lines).toEqual(expect.arrayContaining([`Credential: ${API_REF}`, `Hosts: ${API_HOST}`, WHAT_REMAINS.replace("{host}", API_HOST)]));
    expect(shown?.choices.map((c) => c.choice)).toEqual(["once", "deny"]);
    expect((await decide(w, pat.email, card!.id, "once")).body).toMatchObject({ results: [{ ok: false }] });
    expect((await standing(w, "credentials.revoke")).status).not.toBe(201);
    expect(w.secrets().find((s) => s.ref === API_REF)?.status).toBe("active");
    expect(live(w).sort()).toEqual(["calendar.create", "fixture.create"]);
  });

  it("Sam allows it once: the key, its credential grants and the grant naming it end, the other grant stays, the audit row stays, and the next call is refused", async () => {
    const w = await world([load("credentials"), call("credential_revoke", { ref: API_REF }, "r1"), { text: "It waits on your card." }, { text: "Disconnected." }]);
    await seedKey(w);
    await say(w, "Disconnect my Example API key.");
    const [card] = w.cards("c1");
    w.w.clock.now += 60_000;
    expect((await decide(w, sam.email, card!.id, "once")).body).toMatchObject({ results: [{ ok: true, state: "approved", outcome: "DONE" }] });
    await w.engine("c1").settled();
    expect(transcript(w)).toContain("CREDENTIAL_REVOKED: cred://example-api is revoked with its credential grants and 1 grant(s) naming it");
    expect(w.secrets().find((s) => s.ref === API_REF)?.status).toBe("revoked");
    expect(w.credentialGrants().every((g) => g.revokedAt !== null)).toBe(true);
    expect(live(w)).toEqual(["calendar.create"]);
    expect(w.vaultH.rows("SELECT by, detail FROM vault_events WHERE ref = ? AND event = 'revoked'", API_REF)).toEqual([{ by: sam.email, detail: `card ${card!.id}` }]);
    expect(w.auditRows().filter((a) => a.ref === API_REF)).toHaveLength(1);
    expect(await w.vault().egress({ url: PROBE_API, method: "GET", headers: [["authorization", `Bearer ${API_REF}`]] }, { person: sam.email, purpose: "fixture_read" })).toMatchObject({ ok: false, code: "EGRESS_CRED_REVOKED" });
  });

  describe("the guard", () => {
    const kinds = [...FRESH_CARD_KINDS];
    afterEach(() => {
      (FRESH_CARD_KINDS as string[]).splice(0, FRESH_CARD_KINDS.length, ...kinds);
    });
    it("with credentials.revoke taken out of the fresh-card kinds, a standing grant is signed and the model disconnects on its sentence alone", async () => {
      (FRESH_CARD_KINDS as string[]).splice(FRESH_CARD_KINDS.indexOf("credentials.revoke"), 1);
      const w = await world([load("credentials"), call("credential_revoke", { ref: API_REF }, "r1"), { text: "Done." }]);
      await seedKey(w);
      expect((await standing(w, "credentials.revoke")).status).toBe(201);
      await say(w, "Disconnect my Example API key.");
      expect(w.cards("c1")).toEqual([]);
      // The tool still needs its own card's approval, so the standing grant alone revokes nothing: the guard is the card.
      expect(transcript(w)).toContain("CARD_NOT_APPROVED");
      expect(w.secrets().find((s) => s.ref === API_REF)?.status).toBe("active");
    });
  });
});

describe("[F36] a mailed code's use is the person's card", () => {
  async function seedCode(w: P9Tier1World) {
    await w.vault().capture({ ref: LOGIN_REF, value: seededToken(), kind: "login", hosts: [{ host: LOGIN_HOST, methods: ["GET"], header: "authorization", prefix: "", fills: true }] }, asSam());
    const r = await w.vault().captureOneTimeCode({ person: sam.email, code: "482913", source: "mail from Pat" });
    if (!r.ok) throw new Error(r.code);
    return r.ref;
  }

  it("the card names the site and the mailbox; nothing is granted before Sam's press, and her press grants one fill there", async () => {
    const box: { ref?: string } = {};
    const w = await world([
      load("credentials"),
      { fromRequest: () => call("credential_code_use", { ref: box.ref, host: LOGIN_HOST }, "o1") as never },
      { text: "It waits on your card." },
      { text: "Approved." },
    ] as FakeStep[]);
    box.ref = await seedCode(w);
    await say(w, "Use the code from my mail to sign in.");
    const [card] = w.cards("c1");
    expect(card).toMatchObject({ tool: "credential_code_use", state: "pending" });
    expect(w.w.cardsOf(sam.email)[0]?.lines).toEqual(expect.arrayContaining([`A code for ${LOGIN_HOST}`, "From your mailbox: one-time code from mail from Pat"]));
    expect(w.credentialGrants()).toEqual([]);
    expect((await decide(w, pat.email, card!.id, "once")).body).toMatchObject({ results: [{ ok: false }] });
    expect((await standing(w, "credentials.otp")).status).not.toBe(201);
    expect(w.credentialGrants()).toEqual([]);
    expect((await decide(w, sam.email, card!.id, "once")).body).toMatchObject({ results: [{ ok: true, state: "approved", outcome: "DONE" }] });
    expect(w.credentialGrants()).toEqual([{ ref: box.ref, hosts: [LOGIN_HOST], fill: true, oneShot: true, usedAt: null, revokedAt: null }]);
  });
});

describe("[F36] a company connector's removal", () => {
  it("ends its credential grants and writes one revoked row by the admin; a connector never kept writes none", async () => {
    const w = await world([]);
    const put = await w.vault().putCompany({ connector: "github", value: seededToken(), hosts: [{ host: "api.github.com", methods: ["GET"], header: "authorization", prefix: "Bearer " }], by: sam.email });
    expect(put.ok).toBe(true);
    const ref = w.vaultH.rows("SELECT ref FROM company_refs")[0]?.ref as string;
    expect(w.vault().removeCompany("github", sam.email)).toBe(true);
    expect(w.vaultH.rows("SELECT event, by FROM vault_events WHERE ref = ? AND event = 'revoked'", ref)).toEqual([{ event: "revoked", by: sam.email }]);
    expect(w.vaultH.rows("SELECT COUNT(*) AS n FROM credential_grants WHERE ref = ? AND revoked_at IS NULL", ref)).toEqual([{ n: 0 }]);
    expect(w.vault().removeCompany("linear", sam.email)).toBe(false);
    expect(w.vaultH.rows("SELECT COUNT(*) AS n FROM vault_events WHERE event = 'revoked'")).toEqual([{ n: 1 }]);
  });
});
