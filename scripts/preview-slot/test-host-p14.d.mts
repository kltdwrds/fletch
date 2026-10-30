// Types for ./test-host-p14.mjs (F41), for the hermetic test that runs it.
import type { Standing, ToolLine } from "../../test/evals/p14-identity/world.ts";

type Sql = { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } };
type Home = { read(name: string): Promise<{ text: string; writer: string } | null> };
export declare const SEED_WRITER: string;
export declare const P14_PASSKEY: string;
export declare function systemsText(body: unknown): string | null;
export declare function counts(sql: Sql): Record<string, number>;
export declare function p14ResetStanding(bucket: R2Bucket, person: string, now: number): Promise<string[]>;
export declare function p14Memory(mem: { home: Home; rows(query: string): Array<Record<string, unknown>> }, person: string): Promise<{ standing: Standing[]; seeded: Record<string, string>; daily: string[]; memory: string; memoryWriter: string }>;
export declare function p14SeedPasskey(call: (c: never) => Promise<unknown>, owner: string): Promise<{ added: boolean; count: number }>;
export declare function p14Tools(system: string | null | undefined): Array<ToolLine & { guard: string | null }>;
export declare function p14Mail(rows: unknown[]): Array<{ id: string; outcome: string; counterpart: string }>;
export declare function p14Read(o: {
  mem: { standing: Standing[]; seeded: Record<string, string>; daily: string[]; memory: string; memoryWriter: string; counts: Record<string, number> };
  chat: { systems: string[]; counts: Record<string, number> };
  ledger: { calls: Array<{ id: number; model: string }>; counts: Record<string, number> };
  vault: Record<string, number>;
  journal: unknown[];
}): import("../evals/p14-slot.ts").P14State;
