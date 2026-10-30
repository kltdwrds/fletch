// Types for what the F28 slot-world test (test/workers/f28-evals-p6.test.ts) reads from ./test-host-p6.mjs; the code is
// the .mjs, which the slot's test host (./test-host.mjs) runs.
import type { MemoryService } from "../../packages/agent/src/memory/service.ts";
import type { PersonMemory } from "../../packages/agent/src/memory/store.ts";

/** The person's `Person` as the P6 calls use it. */
export interface P6Person {
  name: string;
  env: { AGENT_BUCKET: R2Bucket };
  personMemory: PersonMemory;
  memory: MemoryService;
  memoryWrite: MemoryService["memoryWrite"];
  forgetConfirm(planId: string, requester: string): Promise<{ ok: boolean; code?: string }>;
}
export function p6Person(p: P6Person, call: Record<string, unknown>): Promise<unknown>;
export function chatRows(sql: { exec(query: string): { toArray(): Record<string, unknown>[] } }): Array<{ seq: number; role: string; tool?: string; isError?: boolean; text: string; calls: string[] }>;
