// Types for ./test-host-p10.mjs (F91), for the hermetic test that runs it.
export declare const P10_ORDERS: string;
export declare const P10_PROBE: string;
export declare const P10_PROSE_URL: string;
export declare function p10Page(origin: string, path: string): string | undefined;
export declare function p10PageAt(url: unknown): string | undefined;
export declare function p10Fixture(request: Request): Response | null;
