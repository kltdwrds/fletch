// Types for ./test-host-p3.mjs (F34), for the hermetic test that runs it.
import type { ChildRow, MailView } from "../../test/evals/p3-delegation/world.ts";
export declare const P3_PROBE: string;
export declare const P3_PROBE_2: string;
export declare const P3_TITLE: string;
export declare const P3_PAGES: Record<string, string>;
export declare const SLOW: Record<string, number>;
export declare const CHUNK: number;
export declare function requestText(body: unknown): string | null;
export declare function chunks(text: string): string[];
export declare function joinChunks(entries: Iterable<[string, string]>): string[];
export declare function p3Rows(sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } }): { children: ChildRow[]; mailbox: MailView[] };
