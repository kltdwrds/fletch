// A person's memory for the hermetic lane: the Person object's memory service over the object
// harness and an in-memory R2, with a clock the test owns. The owner defaults to Sam Solo.
import { homeKey } from "../../../packages/agent/src/memory/home.ts";
import { MemoryService } from "../../../packages/agent/src/memory/service.ts";
import { PersonMemory } from "../../../packages/agent/src/memory/store.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { asBucket, FakeR2 } from "./fake-r2.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { type SeedClaim, seedClaim } from "./seed-claim.ts";

export const DAY1 = Date.UTC(2026, 9, 12, 9, 0, 0);
const personal = { scope: "personal" as const };
const ada = people.people.find((p) => p.id === "sam-solo")!;

export function memoryFor(owner = ada.email) {
  const r2 = new FakeR2();
  const clock = { now: DAY1 };
  const person = new ObjectHarness(owner, (ctx) => new MemoryService(new PersonMemory((ctx as DurableObjectState).storage, asBucket(r2), owner, () => clock.now)), {});
  const key = (path: string) => homeKey(owner, path);
  // A `claim` is seeded as the upkeep would mint it, after the line is written (M15.2).
  const write = async (text: string, extra: Record<string, unknown> = {}, dedupe = crypto.randomUUID()) => {
    const { claim, ctx, ...rest } = extra as { claim?: SeedClaim; ctx?: object };
    const w = await person.instance.memoryWrite({ target: "daily", text, ...rest } as never, { requester: owner, setting: personal, source: "chat:test", dedupe, ...(ctx ?? {}) });
    return claim && w.ok && "path" in w ? seedClaim(person.instance.mem, w, claim) : w;
  };
  return { r2, clock, person, key, write, svc: () => person.instance };
}

