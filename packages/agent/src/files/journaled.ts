// What a delete and a revoke leave behind (F101, P11 deltas 6 and 7; B-P11-12, B-P11-14). A home file's delete ends
// every share of its path with it and writes one Ledger `journal` row, `files.delete`, subject `resource:file:<path>`;
// a share's revoke writes one `files.unshare` row, subject as `share_document`'s own (`connector:files`). Each row goes
// through `JournalRow` and `checkJournalRow` like every other: who, which action, which file and when, and no byte of
// the file. The owner's own delete and revoke need no card (design rules: no gate inside the boundary; a revoke narrows
// exposure). The row is written after the store answered, from its answer; a row the Ledger did not take is said, never
// assumed (`journaled: false`). Both the tool (`file_delete`, `share_revoke`) and the Library's route come here.
import type { JournalRow } from "../grants/journal.ts";
import type { PersonLinks, RevokeResult } from "./links.ts";
import type { DeleteResult, PersonFiles } from "./store.ts";

/** The Ledger's `journal`, as the owner's Person reaches it. */
export type JournalSink = (row: JournalRow) => Promise<unknown>;
/** Who acted: the owner's agent through a tool, or the owner in the app. */
export type Actor = "agent" | "person";

export type JournaledDelete = { ok: true; path: string; sharesEnded: number; journaled: boolean } | Exclude<DeleteResult, { ok: true }>;
export type JournaledRevoke = Extract<RevokeResult, { ok: true }> & { journaled: boolean } | Exclude<RevokeResult, { ok: true }>;

/** One content-free row for a file action of the owner's: identifiers and codes only. */
export function fileRow(o: { owner: string; by: Actor; actionKind: "files.delete" | "files.unshare"; subjectRef: string; at: number }): JournalRow {
  return {
    id: `${o.actionKind}.${crypto.randomUUID()}`,
    at: o.at,
    actor: `${o.by}:${o.owner}`,
    principal: o.owner,
    actionKind: o.actionKind,
    subjectRef: o.subjectRef,
    counterpart: "own-agent",
    origin: o.owner,
    hops: 0,
    decision: "auto",
    grantId: null,
    outcome: "DONE",
    runId: `files:${o.at}`,
    tokens: 0,
  };
}

/** Writes the row; whether the Ledger took it. A refusal or a Ledger that did not answer is `false`, never success. */
async function write(journal: JournalSink | undefined, row: JournalRow): Promise<boolean> {
  if (!journal) return false;
  try {
    const r = (await journal(row)) as { ok?: boolean } | undefined;
    return r?.ok === true;
  } catch {
    return false;
  }
}

/** Deletes a home file, ends every share of it, then journals `files.delete`. */
export async function journaledDelete(d: { files: PersonFiles; links: PersonLinks; journal?: JournalSink }, input: { path: string }, requester: string, by: Actor): Promise<JournaledDelete> {
  const r = await d.files.remove(input, requester);
  if (!r.ok) return r;
  const ended = await d.links.endSharesOf(r.path);
  const journaled = await write(d.journal, fileRow({ owner: requester, by, actionKind: "files.delete", subjectRef: `personal;resource:file:${r.path}`, at: d.links.at() }));
  return { ok: true, path: r.path, sharesEnded: ended.length, journaled };
}

/** Revokes one share by id, then journals `files.unshare`. */
export async function journaledRevoke(d: { links: PersonLinks; journal?: JournalSink }, id: string, requester: string, by: Actor): Promise<JournaledRevoke> {
  const r = await d.links.revoke(id, requester);
  if (!r.ok) return r;
  const journaled = await write(d.journal, fileRow({ owner: requester, by, actionKind: "files.unshare", subjectRef: `personal;connector:files;resource:file:${r.path}`, at: d.links.at() }));
  return { ...r, journaled };
}
