// Types for ./test-host-p5.mjs (F32), for the hermetic test that runs it.
export declare const P5_PROBE: string;
export declare const PAGES: Record<string, string>;
export declare function pageAt(url: unknown, pages?: Record<string, string>): string | undefined;
export declare function systemOf(body: unknown): string | null;
export declare function recordingAi<T extends object>(ai: T, record: (prompt: string) => Promise<void>, skip?: (prompt: string) => boolean): T;
export declare function addressesIn(text: string): string[];
export declare function runMemory(): { get(domain: string): Promise<unknown>; record(row: { domain: string }): Promise<void> };
