// The P13 tasks F70 does not run, skipped by name with the part that runs each (the contract's Build notes): F71 the
// speech (T-P13-02, 03, 05, 06, 07's record half, 08, 09, 12, 15), F72 the surfaces (T-P13-07's Library half, 10, 16),
// F73 tier 2 (T-P13-14). Each file loads and defines its task; each says in its header which part runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LATER: Record<string, { file: string; part: string }> = {
  "T-P13-02": { file: "voice-note-transcript-on-row", part: "F71" },
  "T-P13-03": { file: "audio-caps-refused-by-name", part: "F71" },
  "T-P13-05": { file: "read-aloud-verbatim-in-chosen-voice", part: "F71" },
  "T-P13-06": { file: "partial-render-never-delivered", part: "F71" },
  "T-P13-07": { file: "audio-is-a-findable-record", part: "F71" },
  "T-P13-08": { file: "share-needs-a-card-and-can-be-revoked", part: "F71" },
  "T-P13-09": { file: "voice-changed-only-by-the-person", part: "F71" },
  "T-P13-10": { file: "podcast-episode-record-and-feed-refused", part: "F72" },
  "T-P13-12": { file: "removal-is-recoverable-and-complete", part: "F71" },
  "T-P13-14": { file: "live-round-trip", part: "F73" },
  "T-P13-15": { file: "speech-spend-capped-by-month", part: "F71" },
  "T-P13-16": { file: "voice-set-in-settings", part: "F72" },
};

describe("[F70] P13 voice and audio: the tasks later parts run", () => {
  for (const [id, { file, part }] of Object.entries(LATER)) {
    it(`${id} loads, and its header names ${part} as the part that runs it`, async () => {
      const task = ((await import(`./${file}.task.ts`)) as { default: { id: string; graders: unknown[] } }).default;
      expect([task.id, task.graders.length > 0]).toEqual([id, true]);
      expect(readFileSync(join(import.meta.dirname, `${file}.task.ts`), "utf8").split("\n")[0]).toContain(`Run by ${part}`);
    });
    // biome-ignore lint/suspicious/noSkippedTests: F70's scope skips the later parts' tasks by name, each with the part that runs it
    it.skip(`${id} runs under ${part}, not F70`, () => {});
  }
});
