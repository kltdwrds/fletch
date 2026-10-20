
import { describe, expect, it } from "vitest";
import { FakeWorkspaceAdapter } from "../../packages/agent/src/workspace/fake.ts";
import { actionsCards, connectCard, connectionRequestCard, decisionCard, isWorkshopLink, REFUSED_DECISIONS, type RefusedDecision, workspacePath } from "../../packages/agent/src/workspace/surfaces.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const load = { toolCall: { name: "tool_search", arguments: { load: ["workspace"] } } };

function seeded() {
  const fake = new FakeWorkspaceAdapter("solo-sam", [ada.email]);
  const adas = fake.seedWorkspace(ada.email, "Ada's roadmap");
  fake.seedApproval(adas, "send weekly summary");
  fake.seedApproval(adas, "post update");
  return { fake, adas };
}

describe("[M16.2] link cards in the chat", () => {

  it("the build agent's connection request, met by an action performed after the barrier, is shown as a card linking to its chat", async () => {
    const { fake, adas } = seeded();
    fake.scriptBuildReply({ reply: "I need a Google connection.", chat: "41", connectionRequests: [{ id: "cr-41", chat: "41", vendor: "google", vendorName: "Google", resource: "Google Calendar" }] });
    const w = authorityWorld({ workspace: fake, script: [load, { toolCall: { id: "b1", name: "workspace_build", arguments: { workspace: adas, message: "Use my calendar" } } }, { text: "Asked." }] });
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "workspace.build" }, mode: "auto" });
    const { chatId } = await w.say(ada.email, "Build my board on Google.");
    expect((await w.journal()).find((r) => r.id === `${chatId}:b1`)).toMatchObject({ actionKind: "workspace.build", outcome: "DONE", grantId: expect.stringMatching(/^g_/) });
    expect(w.chats.harness(chatId).instance.linksFor(ada.email)).toEqual([connectionRequestCard(adas, { id: "cr-41", chat: "41", vendor: "google", vendorName: "Google", resource: "Google Calendar" })]);
    expect(w.chats.harness(chatId).instance.linksFor(ada.email)?.[0]?.href).toBe(`/workshop/workspace/${adas}?chat=41&showChat=true`);
  });

  it("the page draws a link card as words and one link: no button, nothing posted", async () => {
    // The script moved into app/chat.ts at M23.1; the shipped page is what is read, wherever its parts live.
    const { APP_PAGE: source } = await import("../../packages/agent/src/http/page.ts");
    const body = /function linkCard\(c, where\) \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, "the page draws link cards").toBeDefined();
    expect(body).not.toMatch(/button|post\(|fetch\(|onclick|decide/);
    expect(source).toMatch(/f\.type === "link"\) linkCard\(f\.card, log\)/);
  });
});

describe("[M16.3] what the agent is told and what is journaled", () => {

  it("a refused decision is framed as failed with AGENT_SESSION_REFUSED and journaled once, content-free; an id the journal cannot hold is left out of the row", async () => {
    const { fake, adas } = seeded();
    const w = authorityWorld({
      workspace: fake,
      script: [
        { text: "Hello." },
        load,
        { toolCall: { id: "d1", name: "workspace_decision", arguments: { decision: "accept_connection", workspace: adas } } },
        { toolCall: { id: "d2", name: "workspace_decision", arguments: { decision: "approve", workspace: "../../app <x>" } } },
        { text: "Accepted." },
      ],
    });
    const { chatId } = await w.say(ada.email, "Hi.");
    const socket = w.chats.harness(chatId).connect();
    await w.say(ada.email, "Accept the connection request for me.", chatId);
    expect(socket.frames.filter((f) => f.type === "action")).toEqual([
      { type: "action", turn: expect.any(String), id: "d1", tool: "workspace_decision", status: "failed", code: "AGENT_SESSION_REFUSED" },
      { type: "action", turn: expect.any(String), id: "d2", tool: "workspace_decision", status: "failed", code: "AGENT_SESSION_REFUSED" },
    ]);
    const rows = (await w.journal()).filter((r) => r.actionKind === "tool.workspace_decision");
    expect(rows).toEqual([
      expect.objectContaining({ id: `${chatId}:d1`, actor: `agent:${ada.email}`, principal: ada.email, decision: "deny", grantId: null, outcome: "AGENT_SESSION_REFUSED", subjectRef: `personal;resource:workspace:${adas}` }),
      expect.objectContaining({ id: `${chatId}:d2`, decision: "deny", outcome: "AGENT_SESSION_REFUSED", subjectRef: "personal" }),
    ]);
    // Both calls were refused to the model and both cards show; nothing reached the workshop.
    const said = w.transcriptOf(ada.email).filter((b) => b.includes("AGENT_SESSION_REFUSED: only your person can"));
    expect(said).toHaveLength(2);
    expect(w.chats.harness(chatId).instance.linksFor(ada.email)?.map((c) => c.kind)).toEqual(["decide_in_workshop", "decide_in_workshop"]);
    expect(await fake.pending({ tenant: "solo-sam", person: ada.email, agent: true })).toMatchObject({ ok: true, value: [{ state: "pending" }, { state: "pending" }] });
  });
});

describe("[M16.2] every card links under the tenant's /workshop/ base", () => {
  it("each builder's link stays under the base, and a hostile workspace or chat id cannot leave it", () => {
    const hostile = ["../../app", "//evil.example", "https://evil.example/x", "a/../../../app", "x#y", "x?y=1"];
    const hrefs = [
      ...hostile.map((id) => workspacePath(id)),
      ...hostile.map((id) => workspacePath("g-1", id)),
      ...actionsCards(hostile.map((id) => ({ id: `${id}:1`, workspace: id, action: "x", state: "pending" as const })), []).map((c) => c.href),
      ...hostile.map((id) => connectionRequestCard(id, { id: "r", chat: id, vendor: "google", vendorName: "Google" }).href),
      ...(Object.keys(REFUSED_DECISIONS) as RefusedDecision[]).flatMap((d) => hostile.map((id) => decisionCard(d, id).href)),
      connectCard("google").href,
    ];
    for (const h of hrefs) expect(isWorkshopLink(h), h).toBe(true);
  });

  it("the check refuses what is not under the base (the guard is live)", () => {
    for (const h of ["https://evil.example/workshop/", "//evil.example/workshop/", "/app/chat", "/workshop/../app", "/workshop/x#frag", "workshop/x"]) expect(isWorkshopLink(h), h).toBe(false);
  });

  it("refused decisions land where the person decides: accounts on the connectors page, the rest in the named workspace", () => {
    for (const d of Object.keys(REFUSED_DECISIONS) as RefusedDecision[]) {
      const href = decisionCard(d, "g-1").href;
      expect(href).toBe(REFUSED_DECISIONS[d].where === "connect" ? "/workshop/gatekeepers" : "/workshop/workspace/g-1");
    }
    expect(decisionCard("share").href).toBe("/workshop/");
  });
});
