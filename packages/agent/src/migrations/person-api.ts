// What the platform and the person's chats ask of a `Person` beyond its own routes (M25.3): the sweep's wake, and the
// per-person `skill_seen` that tells a chat whether a skill changed since this person last read it.
import { type ObjectSchema, probeObject } from "./catalog.ts";
import type { PersonProbe } from "./sweep.ts";
import { type SeenState, SkillSeen } from "../skills/seen.ts";

export type PersonPlatformCall = { op: "probe" } | { op: "skill-seen"; name: string; hash: string };

export interface PersonLists {
  chats(): string[];
  jobs(): string[];
  /** The person's name, which prefixes their job objects' names. */
  name: string;
}

export function personPlatformCall(storage: Pick<DurableObjectStorage, "sql">, schema: ObjectSchema, lists: PersonLists, call: { op: "probe" }): PersonProbe;
export function personPlatformCall(storage: Pick<DurableObjectStorage, "sql">, schema: ObjectSchema, lists: PersonLists, call: { op: "skill-seen"; name: string; hash: string }, now?: () => number): SeenState;
export function personPlatformCall(storage: Pick<DurableObjectStorage, "sql">, schema: ObjectSchema, lists: PersonLists, call: PersonPlatformCall, now: () => number = Date.now): PersonProbe | SeenState {
  if (call.op === "skill-seen") return new SkillSeen(storage).touch(call.name, call.hash, now());
  return { ...probeObject(storage, schema), chats: lists.chats(), jobs: lists.jobs().map((id) => `${lists.name.trim().toLowerCase()}/${id}`) };
}
