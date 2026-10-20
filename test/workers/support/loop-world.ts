// The person loops for the hermetic lane (M12.1): each member's real `PersonMemory`, `LoopSettings`,
// `PersonalLearning` and `PersonLoops` over the object harness and one in-memory R2, the tenant's
// real `Ledger`, and the scripted fake model as the `AI` binding. The clock is the test's. The
// self-learning grant answers `auto` for every member, so a review that merged would show it.
import type { Decision } from "../../../packages/agent/src/grants/types.ts";
import { PersonalLearning } from "../../../packages/agent/src/learning/personal.ts";
import { PersonLoops } from "../../../packages/agent/src/loops/personal.ts";
import { LoopSettings, PERSON_LOOPS } from "../../../packages/agent/src/loops/registry.ts";
import { MemoryService } from "../../../packages/agent/src/memory/service.ts";
import { PersonMemory } from "../../../packages/agent/src/memory/store.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { ada, T0, TENANT } from "./authority-world.ts";
import { asBucket, FakeR2 } from "./fake-r2.ts";

export { ada, T0, TENANT };

export function personLoopWorld(script: FakeStep[] = []) {
  const clock = { now: T0 };
  const fake = new FakeModel(script);
  const r2 = new FakeR2();
  const ledgerH = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), { QYVR_ENV: "test" }, (l) => {
    l.now = () => clock.now;
  });
  const commits: string[] = [];
  const people = new Map<string, ObjectHarness<{ mem: PersonMemory; svc: MemoryService; state: LoopSettings; learning: PersonalLearning; loops: PersonLoops }>>();

  const of = (email: string) => {
    let h = people.get(email);
    if (!h) {
      h = new ObjectHarness(email, (ctx) => {
        const storage = (ctx as DurableObjectState).storage;
        const mem = new PersonMemory(storage, asBucket(r2), email, () => clock.now);
        const state = new LoopSettings(storage, PERSON_LOOPS);
        const learning = new PersonalLearning({
          storage,
          bucket: asBucket(r2),
          person: email,
          commit: async (d) => {
            commits.push(`${email}:${d.actionKind}`);
            return { decision: "auto", grantId: "g_self" } as Decision;
          },
          now: () => clock.now,
        });
        const loops = new PersonLoops({
          mem,
          state,
          model: { ai: fake.binding as unknown as Ai, ledger: ledgerH.instance, tenant: TENANT, wait: async () => {} },
          skillNames: async () => [],
          proposeSkill: async (input) => learning.review(input),
          now: () => clock.now,
        });
        return { mem, svc: new MemoryService(mem), state, learning, loops };
      }, {});
      people.set(email, h);
    }
    return h.instance;
  };

  /** One line in `p`'s daily note, from a chat; with `audience`, learned in a shared setting. */
  const write = async (p: string, text: string, audience?: string[]) => {
    const r = await of(p).svc.memoryWrite({ target: "daily", text }, { requester: p, setting: { scope: "personal", ...(audience ? { audience } : {}) }, source: "chat:test", dedupe: crypto.randomUUID() });
    if (!r.ok) throw new Error(`write refused: ${JSON.stringify(r)}`);
    return (r as { citation: string }).citation;
  };

  /** Every model request's user message, as text: what each call was given. */
  const inputs = () => fake.requests.map((r) => JSON.stringify(r.inputs.messages));

  return { clock, fake, r2, ledger: () => ledgerH.instance, of, write, inputs, commits };
}

/** A scripted answer of one JSON object, with the usage the Ledger records for it. */
export const answer = (json: unknown, usage = { prompt: 400, completion: 100 }): FakeStep => ({ text: JSON.stringify(json), usage });

/** The verify step's answer that applies every numbered mutation with the handle it cites (M25.4). */
export const applyAll = (cites: string[]): FakeStep => answer({ verdicts: cites.map((handle, i) => ({ n: i + 1, verdict: "apply", handle })) });
