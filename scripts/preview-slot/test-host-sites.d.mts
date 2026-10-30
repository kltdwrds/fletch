// Types for ./test-host-sites.mjs (F26, F32), for the hermetic tests that run it.
import type { BrowserBinding } from "../../packages/agent/src/browse/binding.ts";
export declare const CHALLENGE: string;
export declare const NO_LIVE_BROWSER: string;
export declare const SITES: Record<string, { markdown?: string; wall?: "bot" | "rate"; retryAfter?: string }>;
export declare function testHostBinding(record: (e: { kind: string; host: string }) => Promise<unknown>, sites?: typeof SITES, pages?: Record<string, string>): BrowserBinding;
