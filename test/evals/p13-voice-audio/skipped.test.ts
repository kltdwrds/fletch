// The P13 tasks F70 does not run, skipped by name with the part that runs each (the contract's Build notes): F71 the
// speech (T-P13-02, 03, 05, 06, 07's record half, 09, 12, 15 now run in `speech.test.ts`; T-P13-08's share and revoke
// split to F71.2, after F101's `share_revoke`), F72 the surfaces (T-P13-07's Library half, left out of F71's run by name,
// 10, 16), F73 tier 2 (T-P13-14). Each file loads and defines its task; each says in its header which part runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LATER: Record<string, { file: string; part: string; by?: string }> = {
  "T-P13-08": { file: "share-needs-a-card-and-can-be-revoked", part: "F71", by: "F71.2" },
  "T-P13-10": { file: "podcast-episode-record-and-feed-refused", part: "F72" },
  "T-P13-14": { file: "live-round-trip", part: "F73" },
  "T-P13-16": { file: "voice-set-in-settings", part: "F72" },
};

describe("[F70] P13 voice and audio: the tasks later parts run", () => {
  for (const [id, { file, part, by }] of Object.entries(LATER)) {
    it(`${id} loads, and its header names ${part} as the part that runs it`, async () => {
      const task = ((await import(`./${file}.task.ts`)) as { default: { id: string; graders: unknown[] } }).default;
      expect([task.id, task.graders.length > 0]).toEqual([id, true]);
      expect(readFileSync(join(import.meta.dirname, `${file}.task.ts`), "utf8").split("\n")[0]).toContain(`Run by ${part}`);
    });
    // biome-ignore lint/suspicious/noSkippedTests: F70's scope skips the later parts' tasks by name, each with the part that runs it
    it.skip(`${id} runs under ${by ?? part}, not F70`, () => {});
  }
});
