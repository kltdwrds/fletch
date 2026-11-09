// F59 (Q50; triage B.8): a keyed call refused for its host is said by code, from the refusal's own facts, never by the
// model. The gate says it for a read it runs itself (`chat/gate.ts`, `bound-host-words.test.ts`); `browse_fill` is an
// action, performed after the barrier by the approvals, so until this fix it threw a plain error, the journal and the
// action frame carried the code, and the person heard only what the model chose to say. Now the tool throws the
// refusal with its reference, `perform` keeps the facts, and the approvals say the sentence on both action paths: a
// queued action under a standing grant, and a card the person allowed. Every run is the real chat, gate, grants,
// approvals and Vault of the browse world; the Vault alone names the host, the tool the reference.
import { describe, expect, it } from "vitest";
import { hostRefusalWords } from "../../packages/agent/src/connectors/egress.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada } from "./support/authority-world.ts";
import { browseWorld, FILL_ENTRY, LOGIN_HOST, LOGIN_REF } from "./support/browse-world.ts";

/** A host Ada's login is registered on without fill: the refusal is `EGRESS_CRED_HOST_DENIED`. */
const LISTED_HOST = "shop.fixture.example";
/** A host nothing is registered on: the refusal is `EGRESS_HOST_DENIED`. */
const UNLISTED_HOST = "other.fixture.example";
const page = { page: { title: "Sign in", text: "Username and password." } };
const sites = { [LOGIN_HOST]: page, [LISTED_HOST]: page, [UNLISTED_HOST]: page };
const load: FakeStep = { toolCall: { name: "tool_search", arguments: { load: ["browse"] } } };
const script = (host: string, credential = LOGIN_REF): FakeStep[] => [
  load,
  { toolCall: { id: "p1", name: "browse_live", arguments: { url: `https://${host}/` } } },
  { toolCall: { id: "p2", name: "browse_fill", arguments: { selector: "#password", credential } } },
  { text: "I tried to sign you in." },
];
const STANDING = { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "browse.fill" }, mode: "auto" };

async function world(host: string, o: { standing?: boolean; credential?: string } = {}) {
  const w = await browseWorld({ sites, script: script(host, o.credential), extraHosts: [{ ...FILL_ENTRY, host: LISTED_HOST, fills: false }] });
  if (o.standing) await w.grant(ada.email, STANDING);
  const { chatId } = await w.say(ada.email, `Sign me in at https://${host}/ with my fixture login.`);
  const chat = w.chats.harness(chatId);
  return {
    w,
    chatId,
    /** Every sentence code delivered beside a call, by its outbox id. */
    announced: () => chat.rows("SELECT id, payload FROM outbox WHERE id LIKE '%:announce' ORDER BY rowid").map((r) => [String(r.id), (JSON.parse(String(r.payload)) as { text: string }).text]),
    /** What the chat page draws as the agent's words, live and after a reload. */
    drawn: () => chat.instance.history().entries.flatMap((e) => (e.kind === "agent" ? [e.text] : [])),
    outcome: async (id: string) => (await w.journal()).find((r) => r.id === `${chatId}:${id}`)?.outcome,
  };
}

describe("[F59] a fill refused for its host says code's sentence", () => {
  it("a queued fill under a standing grant, on a host the login is not registered on: one sentence, the error still the journal's", async () => {
    const t = await world(UNLISTED_HOST, { standing: true });
    const sentence = hostRefusalWords({ code: "EGRESS_HOST_DENIED", host: UNLISTED_HOST, ref: LOGIN_REF });
    expect(sentence).toBe(`Your fixture-login key is not bound to ${UNLISTED_HOST}, so nothing was sent there; only you can bind it.`);
    expect(t.announced()).toEqual([["p2:announce", sentence]]);
    expect(t.drawn().filter((s) => s === sentence)).toHaveLength(1);
    expect(await t.outcome("p2")).toBe("EGRESS_HOST_DENIED");
    expect(t.w.browser.typed).toEqual([]);
  });

  it("a fill the person allowed on its card, on a host the login may not fill: the sentence follows the card's waiting words, once", async () => {
    const t = await world(LISTED_HOST);
    const sentence = hostRefusalWords({ code: "EGRESS_CRED_HOST_DENIED", host: LISTED_HOST, ref: LOGIN_REF });
    expect(t.announced()).toEqual([["p2:announce", "Waiting for your decision: browse fill. It has not run yet."]]);
    const decided = await t.w.http(ada.email, "POST", `/chats/${t.chatId}/cards/decide`, { ids: ["p2"], choice: "once" });
    expect(decided).toMatchObject({ body: { results: [{ ok: true, state: "failed", outcome: "EGRESS_CRED_HOST_DENIED" }] } });
    expect(t.announced()).toEqual([
      ["p2:announce", "Waiting for your decision: browse fill. It has not run yet."],
      ["p2:decision:announce", sentence],
    ]);
    // History draws the decision's sentence at its call, after the waiting words, with the call's own time: never first.
    const drawn = t.drawn();
    expect(drawn.filter((s) => s === sentence)).toHaveLength(1);
    expect(drawn.indexOf(sentence)).toBeGreaterThan(drawn.indexOf("Waiting for your decision: browse fill. It has not run yet."));
    expect(drawn[0]).not.toBe(sentence);
    expect(await t.outcome("p2:decision")).toBe("EGRESS_CRED_HOST_DENIED");
    expect(t.w.browser.typed).toEqual([]);
  });

  it("planted (F59's rule): a refusal that is not a host refusal says no sentence, and nothing else changes", async () => {
    const t = await world(LOGIN_HOST, { standing: true, credential: "cred://nope" });
    expect(await t.outcome("p2")).toBe("EGRESS_CRED_UNKNOWN");
    expect(t.announced()).toEqual([]);
    expect(t.drawn().some((s) => / is not bound to /.test(s))).toBe(false);
  });
});
