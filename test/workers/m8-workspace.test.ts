// M8.1 on the two-member `solo-sam` world: the `workspace` namespace is the agent's way into the
// company workspace and nothing more. Reads are free; every change is an action the grants engine
// decides and the journal cites; what the agent makes is labeled; Bo's agent sees nothing of Ada's
// unshared workspace; no tool approves, rejects, shares or connects, and a compromised model reaching
// for one changes nothing (families workspace B22, B23 and approval A8).
import { describe, expect, it } from "vitest";
import { agentLabel } from "../../packages/agent/src/workspace/adapters.ts";
import { FakeWorkspaceAdapter } from "../../packages/agent/src/workspace/fake.ts";
import { workspaceNamespace } from "../../packages/agent/src/workspace/tools.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const own = (subject: string, mode = "auto") => ({ grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: subject }, mode });
const load = { toolCall: { name: "tool_search", arguments: { load: ["workspace"] } } };

function workspaces() {
  const fake = new FakeWorkspaceAdapter("solo-sam", [ada.email]);
  const adas = fake.seedWorkspace(ada.email, "Ada's roadmap");
  fake.seedCollection("handbook", [{ path: "leave.md", text: "Leave policy: 25 days." }]);
  return { fake, adas };
}

describe("[M8.1] the workspace namespace under grants", () => {
  it("as Ada, the agent reads a public context collection and creates a labeled app under her grant, and the journal cites it", async () => {
    const { fake, adas } = workspaces();
    const w = authorityWorld({
      workspace: fake,
      script: [load, { toolCall: { name: "workspace_context", arguments: { collection: "handbook" } } }, { toolCall: { name: "workspace_app", arguments: { workspace: adas, name: "Leave tracker" } } }, { text: "Built the leave tracker." }],
    });
    const g = await w.grant(ada.email, own("workspace.app.create"));
    await w.say(ada.email, "Read the handbook and build a leave tracker in my roadmap workspace.");
    expect(fake.inspect(adas).apps.map((a) => a.name)).toEqual([`Leave tracker (${agentLabel(ada.email)})`]);
    const rows = await w.journal();
    expect(rows).toMatchObject([{ actor: `agent:${ada.email}`, principal: ada.email, actionKind: "workspace.app.create", decision: "auto", grantId: g.id, outcome: "DONE" }]);
  });

  it("without a grant the same call queues as a card for Ada and nothing is created", async () => {
    const { fake, adas } = workspaces();
    const w = authorityWorld({ workspace: fake, script: [load, { toolCall: { name: "workspace_app", arguments: { workspace: adas, name: "Leave tracker" } } }, { text: "Waiting for approval." }] });
    await w.say(ada.email, "Build a leave tracker.");
    expect(fake.inspect(adas).apps).toEqual([]);
    expect((await w.journal()).map((r) => [r.actionKind, r.decision, r.outcome])).toEqual([["workspace.app.create", "ask", "PENDING"]]);
    expect(w.cardsOf(ada.email)).toMatchObject([{ state: "pending", flag: null }]);
  });
});

describe("[M8.1] no tool approves, rejects, shares or connects", () => {
  it("the namespace's tools contain no decision, share or connect, and the interfaces it holds have none", () => {
    const { fake } = workspaces();
    const ns = workspaceNamespace({ workspaces: fake, capabilities: fake, approvals: fake }, { tenant: "solo-sam", principal: ada.email });
    expect(ns.tools.map((t) => t.name)).toEqual(["workspace_list", "workspace_context", "workspace_approvals", "workspace_hooks", "workspace_create", "workspace_app", "workspace_build", "workspace_hook", "workspace_bind", "workspace_connect_link", "workspace_decision"]);
    // M16.2's two surface tools are the only decision-shaped names: observations that hand the person a link, never an action.
    const shaped = ns.tools.filter((t) => /approve|reject|decide|decision|share|connect|collaborat/.test(t.name));
    expect(shaped.map((t) => [t.name, t.kind, t.actionKind])).toEqual([["workspace_connect_link", "observation", undefined], ["workspace_decision", "observation", undefined]]);
  });
});
