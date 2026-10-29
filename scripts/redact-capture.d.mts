// Types for what the F19 test reads from scripts/redact-capture.mjs; the code is the .mjs.
export const ALLOWLIST: Set<string>;
export function allowed(key: string): boolean;
export function redactValue(value: unknown, counter?: { stripped: number }, keep?: boolean, key?: string): unknown;
