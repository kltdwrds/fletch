// M25.1 item 3: an opaque surrogate token, shaped like a bearer token a stock SDK accepts, stands for a
// person's credential in the agent's code. The Vault keeps only its hash and swaps it back to its
// reference at egress for its own person, so the registry's hosts and the declared placement bound it
// exactly as a `cred://` reference. Two members: Bo's surrogate never resolves for Ada, nor at Ada's host.
// A surrogate echoed by a vendor or returned by a tool never reaches the model.
import { describe, expect, it } from "vitest";
import { hasSurrogate, mintSurrogate, SURROGATE, SURROGATE_MARK, scrubSurrogates, scrubValue } from "../../packages/agent/src/egress/surrogate.ts";
import { ADA_HOST, ADA_REF, ada, echoVendor, egressWorld, load, seedBoth, vaultOf } from "./support/egress-world.ts";

const T = Date.UTC(2026, 9, 16, 12, 0);
const ctx = (person: string) => ({ person, purpose: "m25_test" });
const bearer = (t: string): Array<[string, string]> => [["authorization", `Bearer ${t}`]];

async function world(name: string) {
  const net = echoVendor();
  const h = vaultOf(name, net.fetch, () => T);
  const tokens = await seedBoth(h.instance);
  const mint = async (person: string, ref: string) => {
    const s = await h.instance.surrogate(person, ref);
    if (!s.ok) throw new Error(s.code);
    return s.token;
  };
  return { net, h, vault: h.instance, tokens, mint };
}

describe("[M25.1] surrogate tokens", () => {

  it("at egress the surrogate is swapped for the value at an approved host, in the declared placement; the vendor's echo of either comes back scrubbed", async () => {
    const w = await world("vault-sur-2");
    const s = await w.mint(ada.email, ADA_REF);
    const r = await w.vault.egress({ url: `https://${ADA_HOST}/orders`, headers: bearer(s) }, ctx(ada.email));
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(w.net.sent.map((x) => x.headers.authorization)).toEqual([`Bearer ${w.tokens.ada}`]);
    const back = JSON.stringify(r);
    expect(back).not.toContain(w.tokens.ada);
    expect(back).not.toContain(s);
    expect(back).toContain(`[redacted ${ADA_REF}]`);
    // The audit row names the reference the surrogate stood for.
    expect(w.vault.audit()).toMatchObject([{ ref: ADA_REF, host: ADA_HOST, outcome: "resolved", person: ada.email }]);
  });

  it("a forged, cut or never-minted surrogate refuses the whole request, and its reason never echoes it", async () => {
    const w = await world("vault-sur-5");
    const s = await w.mint(ada.email, ADA_REF);
    for (const t of [mintSurrogate(), s.slice(0, -3), `${s.slice(0, 5)}${"0".repeat(40)}`, "qyvs_xyz"]) {
      const r = await w.vault.egress({ url: `https://${ADA_HOST}/orders`, headers: bearer(t) }, ctx(ada.email));
      expect(r).toMatchObject({ ok: false, code: "EGRESS_SURROGATE_UNKNOWN" });
      expect(JSON.stringify(r)).not.toContain(t);
    }
    expect(w.net.sent).toEqual([]);
  });

  it("the scrub replaces every surrogate, whole or cut, in text and in nested results", () => {
    const s = mintSurrogate();
    expect(scrubSurrogates(`token ${s} and ${s.slice(0, 12)}`)).toBe(`token ${SURROGATE_MARK} and ${SURROGATE_MARK}`);
    expect(scrubValue({ content: [{ type: "text", text: s }], details: { nested: [s], [s]: 1 } })).toEqual({ content: [{ type: "text", text: SURROGATE_MARK }], details: { nested: [SURROGATE_MARK], [SURROGATE_MARK]: 1 } });
    expect(hasSurrogate(scrubSurrogates(s.repeat(3)))).toBe(false);
    expect(`x ${s} y`.match(SURROGATE)).toEqual([s]);
  });

  it("the hostile model sends with a surrogate and the vendor echoes it and the value: the request is made with the value, and neither reaches the model", async () => {
    const holder: { s?: string } = {};
    const { w, net, vault } = egressWorld([
      load("codefetch"),
      { fromRequest: () => ({ toolCall: { name: "code_fetch", arguments: { url: `https://${ADA_HOST}/orders`, headers: [["authorization", `Bearer ${holder.s}`]] } } }) },
      { fromRequest: () => ({ toolCall: { name: "code_fetch", arguments: { url: `https://${ADA_HOST}/orders?note=${holder.s}`, headers: [["authorization", `Bearer ${holder.s}`]] } } }) },
      { text: "Done." },
    ]);
    const tokens = await seedBoth(vault());
    const s = await vault().surrogate(ada.email, ADA_REF);
    if (!s.ok) throw new Error(s.code);
    holder.s = s.token;
    await w.say(ada.email, "Read my orders.");
    // The first request went with the value; the second carried the surrogate in a query value, an undeclared placement.
    expect(net.sent.map((x) => x.headers.authorization)).toEqual([`Bearer ${tokens.ada}`]);
    const results = w.fake.requests.at(-1)!.inputs.messages.filter((m) => m.role === "tool");
    const shown = JSON.stringify(results);
    expect(shown).toContain("status 200");
    expect(shown).toContain("EGRESS_CRED_PLACEMENT");
    // The model's own tool calls carried the surrogate (they are the hostile steps' arguments): what came back carries neither.
    expect(shown).not.toContain(s.token);
    expect(shown).not.toContain(tokens.ada);
    expect(JSON.stringify(w.transcriptOf(ada.email).filter((m) => m.includes("status 200")))).not.toContain(s.token);
  });
});
