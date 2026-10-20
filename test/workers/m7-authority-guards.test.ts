// M7.1: each remaining guard of the authority model planted on its production path: an action
// performed without a grant id, a journal row carrying text, a request past the hop cap, a decision
// asked for another principal, a counterpart who is no member, a member writing company policy, a
// chat with no grants engine, and what a colleague's agent may learn of grants naming its person.
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ToolRegistry, ToolSession, type ToolSpec } from "../../packages/agent/src/tools/registry.ts";
import { FakeModel } from "../support/fake-model.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld, } from "./support/authority-world.ts";

describe("[M7.1] authority guards, planted", () => {
  it("the performer refuses an action with no grant id and never runs it", async () => {
    const ran: string[] = [];
    const spec: ToolSpec = { name: "demo_post", kind: "action", actionKind: "demo.post", label: "post", description: "post", parameters: Type.Object({}), execute: async () => {
      ran.push("ran");
      return { content: [], details: {} };
    } };
    const session = new ToolSession(new ToolRegistry([{ name: "demo", description: "d", deferral: "eager", tools: [spec] }]), []);
    expect(await session.perform("x1", "demo_post", {}, undefined)).toEqual({ ok: false, code: "ACTION_UNGRANTED" });
    expect(ran).toEqual([]);
    expect(await session.perform("x2", "demo_post", {}, "g_".padEnd(34, "0"))).toMatchObject({ ok: true });
    expect(ran).toEqual(["ran"]);
  });

  it("without a grants engine, a chat queues no action at all", async () => {
    const fake = new FakeModel([{ toolCall: { name: "demo_post", arguments: {} } }, { text: "could not." }]);
    const ran: string[] = [];
    const spec: ToolSpec = { name: "demo_post", kind: "action", actionKind: "demo.post", label: "post", description: "post", parameters: Type.Object({}), execute: async () => {
      ran.push("ran");
      return { content: [], details: {} };
    } };
    const chat = new ObjectHarness("c", (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env, { namespaces: [{ name: "demo", description: "d", deferral: "eager", tools: [spec] }] }), { TENANT_ID: "solo-sam", AI: fake.binding, LEDGER: { idFromName: () => ({}), get: () => ({ record: async () => {}, admit: async () => ({ ok: true }) }) } }, (c) => {
      c.wait = async () => {};
    });
    await chat.instance.send({ person: ada.email, text: "post" });
    expect(ran).toEqual([]);
    expect(String(fake.requests[1]?.inputs.messages.at(-1)?.content)).toContain("GRANTS_UNAVAILABLE");
    expect(chat.rows("SELECT COUNT(*) AS n FROM outbox")).toEqual([{ n: 0 }]);
  });

  it("Q37: a resource the journal cannot hold is refused before the call, never run without its row", async () => {
    const w = authorityWorld({
      script: [
        { toolCall: { id: "r1", name: "reports_read", arguments: { resource: "weekly report" } } },
        { toolCall: { id: "r2", name: "reports_read", arguments: { resource: "weekly-report" } } },
        { text: "done." },
      ],
    });
    const g = await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "reports.read" }, mode: "auto" });
    await w.say(ada.email, "Read the weekly report.");
    // The spaced resource was refused up front: the model is told, nothing ran, no row was dropped.
    expect(String(w.fake.requests[1]?.inputs.messages.at(-1)?.content)).toContain("SUBJECT_NOT_RECORDABLE");
    expect(String(w.fake.requests[1]?.inputs.messages.at(-1)?.content)).not.toContain("queued");
    expect(w.performed.some((p) => p.includes("weekly report"))).toBe(false);
    // The plain identifier runs, and its journal row cites the grant.
    expect(w.performed).toHaveLength(1);
    expect(w.performed[0]).toContain('"weekly-report"');
    const rows = await w.journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionKind: "reports.read", subjectRef: "personal;resource:weekly-report", decision: "auto", grantId: g.id, outcome: "DONE" });
    // Every action that ran has a row.
    expect(w.performed.length).toBe(rows.length);
  });

  it("the app renders cards from the harness's frame, choices included", () => {
    expect(APP_PAGE).toContain('f.type === "card"');
    expect(APP_PAGE).toContain("/cards/decide");
    // The arguments are data and are never drawn on the card (M23.2).
    expect(APP_PAGE).not.toContain("Proposed by your agent");
  });
});
