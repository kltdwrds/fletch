// Types for what the F30 slot-world test (test/workers/f30-evals-p7.test.ts) reads from ./test-host-p7.mjs; the code is
// the .mjs, which the slot's test host (./test-host.mjs) runs.
type Json = Record<string, unknown>;
type Answer = { ok: boolean; code?: string; reason?: string } & Json;
type Got = { ok: true; status: number; headers: Array<[string, string]>; body: string };

export const PROBE: string;
export const PROBE_PAGE: string;
export function probeGet(record: (e: { url: string; credentialed: boolean }) => unknown): (url: string, headers?: Array<[string, string]>) => Promise<Got>;
export function clockedStorage<S extends { sql: unknown; transactionSync(f: () => unknown): unknown; setAlarm(t: number): unknown; deleteAlarm(): unknown }>(storage: S, skew: () => number): Pick<S, "sql" | "transactionSync" | "setAlarm" | "deleteAlarm">;
export function skewToNext(skew: number, alarm: number | null, now: number): number | null;

/** The stubs a `p7` call reaches, each with the test host's methods. */
export interface P7Host {
  person: { jobIds(owner: string): Promise<string[] | null>; testHostP7Reset(zone: string): Promise<unknown> };
  job(id: string): {
    define(a: { owner: string; by: string; def: Json }): Promise<Answer>;
    disable(by: string): Promise<Answer>;
    remove(by: string): Promise<Answer>;
    inspect(by: string): Promise<Answer>;
    testHostTick(): Promise<Answer>;
    testHostClock(): Promise<{ alarmAt: number | null; now: number; egress: Array<{ url: string; credentialed: boolean }> }>;
  };
  chat(id: string): Promise<{ testHostNotices(): Promise<Array<{ source: string; text: string; at?: number }>> }>;
  ledger: { testHostCalls(): Promise<Array<{ person: string; run_id: string; route: string }>> };
}
export function p7Op(call: Json, owner: string, h: P7Host): Promise<Answer>;
