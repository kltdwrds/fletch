// Standing-file injection (AD-6 block 3). A chat takes a snapshot of the person's standing files on
// its first turn and keeps it in the stable prefix, so the prefix stays byte-identical. When a file
// changes later, the chat records a diff message in its transcript instead, fenced as data with its
// source label; the snapshot is refreshed at compaction, when the prefix is rebuilt anyway.
import { fence } from "../context/fence.ts";

export interface StandingCopy {
  name: string;
  text: string;
  sha256: string;
}

export const STANDING_DIFF_SOURCE = "memory:standing-files";

/** Lines removed and added per changed file, in file order; a line-set diff is enough to read. */
export function standingDiff(before: StandingCopy[], after: StandingCopy[]): string | null {
  const old = new Map(before.map((f) => [f.name, f]));
  const parts: string[] = [];
  for (const f of after) {
    const prev = old.get(f.name);
    if (prev && prev.sha256 === f.sha256) continue;
    const was = prev ? prev.text.split("\n") : [];
    const now = f.text.split("\n");
    const removed = was.filter((l) => l.trim() && !now.includes(l));
    const added = now.filter((l) => l.trim() && !was.includes(l));
    parts.push(`${f.name} changed (sha256 ${prev?.sha256.slice(0, 12) ?? "none"} -> ${f.sha256.slice(0, 12)}):`, ...removed.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`));
  }
  if (!parts.length) return null;
  return fence(STANDING_DIFF_SOURCE, ["The person's standing files changed since this chat began; the current lines win over the copy above.", ...parts].join("\n"));
}
