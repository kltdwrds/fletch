// Types for ./test-host-p11.mjs (F102), for the hermetic test that runs it.
import type { Entry } from "../../test/evals/p11-files/world.ts";

type Sql = { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } };
export declare const P11_SEED_PATH: RegExp;
export declare const P11_SEED_MAX: number;
export declare const DOCX_TYPE: string;
export declare function p11Entries(sql: Sql): Entry[];
export declare function p11Seed(input: unknown): { ok: true; path: string; bytes: Uint8Array; mediaType: string } | { ok: false; code: string; reason: string };
