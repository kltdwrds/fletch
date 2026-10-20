// A hermetic chat with sub-agents (M7.2): the real `ChatEngine`, the real `SubAgentHost` and store
// over the chat's own storage, each sub-agent's real `runSubAgent` over its own storage (a facet's
// isolated SQLite, as staging measured), the real verifier and the real `Ledger`. The alarm is the
// test's: `alarm()` runs the host's step as the `Chat` object's scheduled callback does. One fake
// model script serves the chat, the sub-agents and the verifier, in the order the steps run. The
// sub-agents read fixture tools; anything they run is logged in `performed`.
import { Type } from "@earendil-works/pi-ai";
import { ChatEngine, type EngineCtx } from "../../../packages/agent/src/chat/engine.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { type SubAgentTransport, SubAgentHost } from "../../../packages/agent/src/subagents/host.ts";
import { runSubAgent, type SubAgentInput } from "../../../packages/agent/src/subagents/run.ts";
import { SubAgentStore } from "../../../packages/agent/src/subagents/store.ts";
import { verifyHandoff } from "../../../packages/agent/src/subagents/verifier.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import { FakeModel, type FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import people from "../../fixtures/people.json" with { type: "json" };

export const TENANT = "solo-sam";
export const ada = people.people.find((p) => p.id === "sam-solo") as (typeof people.people)[number];
export const T0 = Date.UTC(2026, 9, 13, 10, 0);

const args = Type.Object({}, { additionalProperties: true });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export interface SubAgentWorldOptions {
  script?: FakeStep[];
  /** Replaces the facet transport, to plant what a facet returns. */
  transport?: (real: SubAgentTransport) => SubAgentTransport;
  /** Replaces the sub-agents' fixture tools: M7.3 gives them the production namespaces over real stores. */
  reads?: (person: string) => Namespace[];
}

export function subagentWorld(o: SubAgentWorldOptions = {}) {
  const clock = { now: T0 };
  const fake = new FakeModel(o.script ?? []);
  const env = { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test", HOST: { memberSeed: JSON.stringify([ada].map((p) => ({ email: p.email, role: p.role, name: p.name }))) } };
  const performed: string[] = [];
  const ledgerH = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), env, (l) => {
    l.now = () => clock.now;
  });
  const ledger = () => ledgerH.instance;
  const wait = async () => {};

  /** The sub-agents' fixture tools: one read, one action, one write of the person's own drafts. */
  const fixtureReads = (person: string): Namespace[] => [
    {
      name: "fixtures",
      description: "fixture tools",
      deferral: "eager",
      tools: [
        { name: "notes_read", kind: "observation", label: "notes", description: "Fixture: the person's notes.", parameters: args, execute: async () => text(`notes of ${person}: launch is Thursday; budget 120`) },
        {
          name: "mail_send", kind: "action", label: "send mail", description: "Fixture: send mail.", parameters: args, actionKind: "mail.send", subject: () => ({ scope: "personal", connector: "mail" }),
          execute: async (_id, a) => {
            performed.push(`mail_send:${JSON.stringify(a)}`);
            return text("sent");
          },
        },
        {
          name: "drafts_save", kind: "observation", label: "save a draft", description: "Fixture: save a draft.", parameters: args, mutates: true,
          execute: async (_id, a) => {
            performed.push(`drafts_save:${JSON.stringify(a)}`);
            return text("saved");
          },
        },
      ],
    },
  ];
  const reads = o.reads ?? fixtureReads;

  /** Facets: one harness per sub-agent id, so each has its own SQLite, as a facet does. */
  const facets = new Map<string, ObjectHarness<{ run(i: SubAgentInput): ReturnType<typeof runSubAgent> }>>();
  const runs: SubAgentInput[] = [];
  const realTransport: SubAgentTransport = {
    run: async (input) => {
      runs.push(input);
      let h = facets.get(input.id);
      if (!h) {
        h = new ObjectHarness(`subagent:${input.id}`, (ctx) => ({
          run: (i: SubAgentInput) => runSubAgent((ctx as DurableObjectState).storage, { ai: fake.binding as unknown as Ai, ledger: ledger(), tenant: TENANT, namespaces: reads, now: () => clock.now, wait }, i),
        }), env);
        facets.set(input.id, h);
      }
      return h.instance.run(input);
    },
  };
  const transport = o.transport ? o.transport(realTransport) : realTransport;

  let arms = 0;
  const chat = new ObjectHarness<{ engine: ChatEngine; host: SubAgentHost; store: SubAgentStore }>(
    "chat-1",
    (ctx, e) => {
      const storage = (ctx as DurableObjectState).storage;
      const store = new SubAgentStore(storage);
      let host: SubAgentHost;
      const engine = new ChatEngine(ctx as EngineCtx, e as Env, {
        subagents: { open: () => store.open(), status: () => host.status(), close: (person, ids) => host.close(person, ids), delegate: (input) => host.delegate(input) },
      });
      engine.now = () => clock.now;
      engine.wait = wait;
      host = new SubAgentHost({
        store,
        transport,
        verify: (who, brief, handoff) => verifyHandoff({ ai: fake.binding as unknown as Ai, ledger: ledger(), tenant: TENANT, now: () => clock.now, wait }, who, brief, handoff),
        handoff: (h) => engine.handoff(h),
        arm: async () => {
          arms++;
        },
        now: () => clock.now,
      });
      return { engine, host, store };
    },
    { ...env, AI: fake.binding, LEDGER: { idFromName: (n: string) => ({ name: n }), get: () => ledger() } },
  );

  const say = (textIn: string, person = ada.email) => chat.instance.engine.send({ person, text: textIn });
  /** The `Chat`'s scheduled sub-agent step, as its alarm runs it. */
  const alarm = () => chat.instance.host.step();
  /** Runs alarms until no sub-agent work remains; a run that never settles fails the test. */
  const settle = async (max = 20) => {
    for (let i = 0; i < max; i++) {
      const s = chat.instance.store;
      if (!s.next() && !s.settledGroups().length) return i;
      await alarm();
    }
    throw new Error("SUBAGENTS_DID_NOT_SETTLE");
  };
  const rows = () => chat.instance.store.list();
  const transcript = () => chat.rows("SELECT body FROM messages ORDER BY seq").map((r) => String(r.body));
  const toolResults = () => fake.requests.flatMap((r) => r.inputs.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));

  return { clock, fake, performed, chat, ledger, say, alarm, settle, rows, transcript, toolResults, runs, arms: () => arms };
}

export type SubAgentWorld = ReturnType<typeof subagentWorld>;

/** A verifier answer in the format the verifier parses. */
export const verdict = (v: "pass" | "fail", reason = "answers the brief"): FakeStep => ({ text: JSON.stringify({ verdict: v, reason }) });
