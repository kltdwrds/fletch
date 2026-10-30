// Sub-agents inside a world's chat (F31), as `subagent-world.ts` wires them for one chat (M7.2): the real
// `SubAgentHost` and store over the chat's own storage, each sub-agent's real `runSubAgent` over its own storage (a
// facet's isolated SQLite), the real verifier and the world's Ledger. The alarm is the test's: `settle()` runs the
// host's step as the `Chat` object's scheduled callback does. The world's one fake model script serves them all.
import type { ChatEngine } from "../../../packages/agent/src/chat/engine.ts";
import type { SubAgentRows } from "../../../packages/agent/src/chat/activity-subagents.ts";
import type { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { SubAgentHost } from "../../../packages/agent/src/subagents/host.ts";
import { readTranscript, runSubAgent } from "../../../packages/agent/src/subagents/run.ts";
import { SubAgentStore } from "../../../packages/agent/src/subagents/store.ts";
import { verifyHandoff } from "../../../packages/agent/src/subagents/verifier.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import { ObjectHarness } from "../../support/object-harness.ts";

export interface SubAgentDeps {
  ai: Ai;
  ledger: () => Ledger;
  tenant: string;
  now: () => number;
  env: Record<string, unknown>;
  /** The sub-agents' tools, given their person. */
  reads: (person: string) => Namespace[];
}

export type WiredSubAgents = ReturnType<typeof wireSubAgents>;

/** The chat's sub-agent hooks over `storage`; `bind` gives the host the engine its handoffs wake. */
export function wireSubAgents(storage: DurableObjectStorage, d: SubAgentDeps) {
  const store = new SubAgentStore(storage);
  const wait = async () => {};
  type Facet = { run: (i: Parameters<typeof runSubAgent>[2]) => ReturnType<typeof runSubAgent>; transcript: () => Promise<ReturnType<typeof readTranscript>> };
  const facets = new Map<string, ObjectHarness<Facet>>();
  const facet = (id: string): Facet => {
    let h = facets.get(id);
    if (!h) {
      h = new ObjectHarness<Facet>(`subagent:${id}`, (ctx) => ({
        run: (i) => runSubAgent((ctx as DurableObjectState).storage, { ai: d.ai, ledger: d.ledger(), tenant: d.tenant, namespaces: d.reads, now: d.now, wait }, i),
        transcript: async () => readTranscript((ctx as DurableObjectState).storage),
      }), d.env);
      facets.set(id, h);
    }
    return h.instance;
  };
  let engine: ChatEngine | null = null;
  const host = new SubAgentHost({
    store,
    transport: { run: async (input) => facet(input.id).run(input) },
    verify: (who, brief, handoff) => verifyHandoff({ ai: d.ai, ledger: d.ledger(), tenant: d.tenant, now: d.now, wait }, who, brief, handoff),
    handoff: (h) => (engine as ChatEngine).handoff(h),
    arm: async () => {},
    now: d.now,
  });
  const hooks = { open: () => store.open(), status: () => host.status(), close: (person: string, ids: string[]) => host.close(person, ids), delegate: (input: Parameters<SubAgentHost["delegate"]>[0]) => host.delegate(input) };
  const record: SubAgentRows = { group: (g) => store.group(g), handedOffAt: (g) => store.handedOffAt(g), transcript: async (id) => facet(id).transcript() };
  return {
    store,
    host,
    hooks,
    record,
    /** The facets' own storage, by sub-agent id: every table the world enumerates. */
    facets,
    bind: (e: ChatEngine) => {
      engine = e;
    },
    /** Runs the host's alarms until no sub-agent work remains; a run that never settles throws. */
    settle: async (max = 20) => {
      for (let i = 0; i < max; i++) {
        if (!store.next() && !store.settledGroups().length) return;
        await host.step();
      }
      throw new Error("SUBAGENTS_DID_NOT_SETTLE");
    },
  };
}
