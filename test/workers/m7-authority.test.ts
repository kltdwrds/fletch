
import { describe, expect, it } from "vitest";
import { verifyJournal } from "../../packages/agent/src/grants/verify.ts";
import { ada, authorityWorld, } from "./support/authority-world.ts";

const own = (subject: string, mode = "auto") => ({ grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: subject }, mode });

describe("[M7.1] approvals: only the principal decides", () => {

  it("purchases offer allow once or decline only, and a one-shot grant runs the purchase once", async () => {
    const buy = { toolCall: { name: "shop_buy", arguments: { item: "chair", amount: 90 } } };
    const w = authorityWorld({ script: [buy, buy] });
    const { chatId } = await w.say(ada.email, "Buy the chair.");
    const [card] = w.cardsOf(ada.email);
    expect(card?.choices.map((c) => c.choice)).toEqual(["once", "deny"]);
    expect((await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice: "always" })).body).toMatchObject({ results: [{ ok: false, code: "PURCHASE_NOT_LASTING" }] });
    expect((await w.http(ada.email, "POST", "/api/grants", { ...own("purchase"), created_from: "chat-confirmation" })).body).toMatchObject({ code: "GRANT_PURCHASE_LASTING" });
    expect((await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice: "once" })).body).toMatchObject({ results: [{ ok: true, state: "approved" }] });
    expect(w.performed).toHaveLength(1);
    // The same purchase again: the one-shot grant is spent, so it is a new card, not a second buy.
    await w.say(ada.email, "Buy another.", chatId);
    expect(w.performed).toHaveLength(1);
    expect(w.cardsOf(ada.email).filter((c) => c.state === "pending")).toHaveLength(1);
  });

  it("a declined proposal is final: proposed again, it is refused without a new card", async () => {
    const send = { toolCall: { name: "mail_send", arguments: {  } } };
    const w = authorityWorld({ script: [send, send, { text: "I won't." }] });
    const { chatId } = await w.say(ada.email, "Send it.");
    const [card] = w.cardsOf(ada.email);
    await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice: "deny" });
    await w.say(ada.email, "Keep going.", chatId);
    expect(w.performed).toEqual([]);
    expect(w.cardsOf(ada.email)).toHaveLength(1);
    expect((await w.journal()).map((r) => r.outcome)).toEqual(["PENDING", "DECLINED", "DENIED_BEFORE"]);
  });
});

describe("[M7.1] simulation, the latch and awaitDecision", () => {
  it("a simulated pending action reads back as applied, and no reply names the approval queue", async () => {
    const w = authorityWorld({
      script: [
        { toolCall: { name: "calendar_move", arguments: { event: "evt-2", to: "fri" } } },
        { toolCall: { name: "calendar_list", arguments: {} } },
        { toolCall: { name: "send_to_user", arguments: { text: "evt-2 is on Friday now." } } },
        { text: "Done." },
      ],
    });
    const { chatId, result } = await w.say(ada.email, "Move evt-2 to Friday and check my calendar.");
    expect(result).toEqual({ status: "done", turnId: expect.any(String) });
    expect(w.performed).toEqual([]);
    const tools = (w.fake.requests.at(-1)?.inputs.messages ?? []).filter((m) => m.role === "tool").map((m) => String(m.content));
    expect(tools[0]).toContain("moved evt-2 to fri");
    expect(tools[1]).toContain("evt-2: fri");
    expect(w.cardsOf(ada.email)).toMatchObject([{ state: "pending", lines: expect.arrayContaining(["Your agent carried on as if this were done; nothing has happened yet."]) }]);
    const said = [...w.transcriptOf(ada.email), ...tools].join("\n").toLowerCase();
    expect(said).not.toContain("approval queue");
    expect(w.calendar.get(ada.email)?.get("evt-2")).toBe("wed");
    // Approved in bulk later: the real move happens then.
    const ids = w.cardsOf(ada.email).map((c) => c.id);
    expect((await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids, choice: "once" })).body).toMatchObject({ results: [{ ok: true, outcome: "DONE" }] });
    expect(w.calendar.get(ada.email)?.get("evt-2")).toBe("fri");
  });

  it("awaitDecision when nothing can be projected: the turn stops at the proposal", async () => {
    const w = authorityWorld({ script: [{ toolCall: { name: "mail_send", arguments: {  } } }, { text: "unused" }] });
    const { result } = await w.say(ada.email, "Mail Bo.");
    expect(result).toMatchObject({ status: "done", awaiting: true });
    expect(w.fake.remaining).toBe(1);
    const toolText = w.transcriptOf(ada.email).find((m) => m.includes("AWAITING_DECISION"));
    expect(toolText).toContain("Sam Solo decides whether this runs");
  });
});

describe("[M7.1] the code gate, planted", () => {
  it("an action whose grant is revoked between the call and the commit does not run", async () => {
    const w = authorityWorld({ script: [{ toolCall: { name: "mail_send", arguments: {  } } }, { text: "Sent." }] });
    const g = await w.grant(ada.email, own("mail.send"));
    w.hooks.beforeCommit = async () => {
      await w.http(ada.email, "POST", `/api/grants/${g.id}/revoke`);
    };
    await w.say(ada.email, "Mail Bo.");
    expect(w.performed).toEqual([]);
    expect((await w.journal()).map((r) => [r.decision, r.outcome])).toEqual([["ask", "PENDING"]]);
  });

  it("with a standing grant the action runs without a card and cites the grant (B9)", async () => {
    const w = authorityWorld({ script: [{ toolCall: { name: "mail_send", arguments: {  } } }, { text: "Sent." }] });
    const g = await w.grant(ada.email, own("mail.send"));
    await w.say(ada.email, "Mail Bo.");
    expect(w.performed).toHaveLength(1);
    expect(w.cardsOf(ada.email)).toEqual([]);
    const rows = await w.journal();
    expect(rows).toMatchObject([{ decision: "auto", grantId: g.id, outcome: "DONE" }]);
    expect(verifyJournal(rows, await w.grantsNow(), await w.view())).toEqual([]);
  });
});
