// Types for ./test-host-p13.mjs (F73), for the hermetic test that runs it.
type Sql = { exec(query: string, ...bindings: unknown[]): { toArray(): Array<Record<string, unknown>> } };
type SpeechLike = { speak(input: { text: string; speaker: string; person: string; ref: string }): Promise<{ ok: true; bytes: Uint8Array; ms: number } | { ok: false; code: string; reason: string }> };
export type P13Row = { id: string; name: string; mime: string; size: number; cls: string; sha256: string; status: string; code: string | null; transcript: string | null };
export type P13Audio = { id: string; kind: string; path: string; durationMs: number; voice: string; model: string; source: string; removed: boolean };
export type P13Call = { id: number; person: string; model: string; status: string; code: string | null; costMicros: number; at: number };
export declare function p13Probe(speech: SpeechLike | null, owner: string, speaker: string): Promise<{ ok: true; audio: string; ms: number } | { ok: false; code: string; reason: string }>;
export declare function p13PersonRows(sql: Sql): { rows: P13Row[]; audio: P13Audio[] };
export declare function p13SpeechCalls(sql: Sql): P13Call[];
