// The compaction step a turn runs before it assembles its context (moved out of `engine.ts` at M20.1 to
// keep it under the file cap): when the last request was large enough, the turns before the latest user
// message are summarised on the `compaction` route and replaced by the summary, with a record kept.
// From M24.2 the person can also ask for one from the agent sheet (`manual`), a compaction that fails is
// a row with its code and reason rather than silence, the epoch advances at the checkpoint, and the
// todo snapshot is kept beside the summary.
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { modelFor } from "../model/routes.ts";
import { shouldCompact, summarise, summaryMessage } from "./compaction.ts";
import { EPOCH_KEY } from "./mailbox.ts";
import type { ChatStore, CompactionRecord, CompactionTrigger } from "./store.ts";
import { keepTodoAtCompaction } from "./todo.ts";

export type Compacted = { ok: true; record?: CompactionRecord } | { ok: false; code: string; detail: string };

/** `chat` is the model this deploy's turn runs on (`modelFor("chat", modelConfig(env))`): its window sets the threshold. */
export async function compactIfDue(store: ChatStore, streamFn: StreamFn, turnId: string, at: number, chat: Model<string>): Promise<Compacted> {
  if (!shouldCompact(store.lastInputTokens(), chat)) return { ok: true };
  return compact(store, streamFn, turnId, at, "threshold");
}

/** Compacts the turns before the latest user message now; nothing older to fold is `NOTHING_TO_COMPACT` for a manual one. */
export async function compact(store: ChatStore, streamFn: StreamFn, turnId: string, at: number, trigger: CompactionTrigger): Promise<Compacted> {
  const rows = store.transcript();
  let lastUser = -1;
  rows.forEach((r, i) => {
    if (r.message.role === "user") lastUser = i;
  });
  const older = rows.slice(0, Math.max(lastUser, 0));
  const keepFrom = rows[lastUser];
  if (!older.length || !keepFrom) return trigger === "manual" ? { ok: false, code: "NOTHING_TO_COMPACT", detail: "there are no earlier turns to fold into a summary" } : { ok: true };
  const summary = store.meta("summary");
  const input = [...(summary ? [summaryMessage(summary, 0)] : []), ...older.map((r) => r.message)];
  const where = { turnId, checkpointSeq: rows.at(-1)?.seq ?? keepFrom.seq, tokensBefore: store.lastInputTokens(), at, trigger };
  let result: Awaited<ReturnType<typeof summarise>>;
  try {
    result = await summarise(streamFn, modelFor("compaction"), input);
  } catch (err) {
    result = { ok: false, code: "COMPACTION_FAILED", detail: String(err instanceof Error ? err.message : err) };
  }
  if (!result.ok) {
    const failed = result;
    store.transaction(() => store.compactionFailed({ ...where, code: failed.code, reason: failed.detail }));
    return failed;
  }
  const done = result;
  const record = store.transaction(() => {
    const r = store.compactBefore(keepFrom.seq, done.summary, where);
    // The prefix is rebuilt here anyway, so it takes the files as last seen.
    const seen = store.meta("standingSeen");
    if (seen) store.setMeta("standing", seen);
    store.setMeta(EPOCH_KEY, String(Number(store.meta(EPOCH_KEY) ?? "0") + 1));
    keepTodoAtCompaction(store);
    return r;
  });
  return { ok: true, record };
}
