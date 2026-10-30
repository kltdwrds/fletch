// Types for ./test-host-p9.mjs (F37), for the hermetic test that runs it.
import type { AuditView, CardView, HostView, SentView } from "../../test/evals/p9-connectors/world.ts";

type Sql = { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } };
export declare const P9_FIXTURE: string;
export declare const P9_API: string;
export declare const P9_TABLES: Array<[string, string]>;
export declare function p9Fixture(request: Request): Response | null;
export declare function p9Network(record: (s: SentView) => Promise<void> | void): (url: string, init?: RequestInit) => Promise<Response>;
export declare function p9Reset(sql: Sql, person: string): void;
export declare function p9VaultRows(sql: Sql, person: string): { hosts: HostView[]; audit: AuditView[]; events: Array<{ ref: string; event: string; by: string }> };
export declare function p9ChatRows(sql: Sql): { cards: CardView[]; messages: string[] };
