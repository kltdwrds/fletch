// Types for ./test-host-p12.mjs (F39), for the hermetic test that runs it.
import type { CardWords, GrantRow, JournalView } from "../../test/evals/p12-wallet/world.ts";

type Sql = { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } };
export declare const P12_DEAD: string;
export declare const P12_TABLES: string[];
export declare function p12Reset(sql: Sql): void;
export declare function p12Cards(storage: { sql: Sql }, nameOf: (email: string) => string): CardWords[];
export declare function p12Grants(grants: unknown[] | null): GrantRow[];
export declare function p12Journal(rows: unknown[]): JournalView[];
