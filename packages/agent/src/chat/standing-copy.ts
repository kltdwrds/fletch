// The chat's copy of the person's standing files (M2): fixed in the prompt's prefix at the first turn
// and at compaction; a change since last seen enters the transcript as a fenced diff message.
import type { Message } from "@earendil-works/pi-ai";
import type { StandingFile } from "../context/assemble.ts";
import { type StandingCopy, standingDiff } from "../memory/standing.ts";

interface Meta {
  meta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  appendMessage(turnId: string, message: Message): void;
}

/** The prefix's copy of the standing files, fixed at the first turn and at compaction. */
export function standingSnapshot(store: Meta): StandingFile[] {
  const raw = store.meta("standing");
  return raw ? (JSON.parse(raw) as StandingCopy[]).map((f) => ({ name: f.name, text: f.text })) : [];
}

/** Takes the first snapshot, or records a fenced diff message when a file changed since last seen. */
export function noteStanding(store: Meta, turnId: string, files: StandingCopy[], at: number): void {
  const seen = store.meta("standingSeen");
  const current = JSON.stringify(files);
  if (!seen) {
    store.setMeta("standing", current);
    store.setMeta("standingSeen", current);
    return;
  }
  const diff = standingDiff(JSON.parse(seen) as StandingCopy[], files);
  if (!diff) return;
  store.appendMessage(turnId, { role: "system", content: diff, timestamp: at } as Message);
  store.setMeta("standingSeen", current);
}
