// What a delete and a revoke leave behind (F101, P11 deltas 6 and 7; B-P11-12, B-P11-14). A home file's delete ends
// every share of its path with it and writes one Ledger `journal` row, `files.delete`, subject `resource:file:<path>`;
// a share's revoke writes one `files.unshare` row, subject as `share_document`'s own (`connector:files`). Each row goes
// through `JournalRow` and `checkJournalRow` like every other: who, which action, which file and when, and no byte of
// the file. The owner's own delete and revoke need no card (design rules: no gate inside the boundary; a revoke narrows
// exposure). The row is written after the store answered, from its answer; a row the Ledger did not take is said, never
// assumed (`journaled: false`). Both the tool (`file_delete`, `share_revoke`) and the Library's route come here.
import type { JournalRow } from "../grants/journal.ts";
import type { PersonLinks, RevokeResult } from "./links.ts";
import { type DeleteResult, type PersonFiles, parseFilePath, type RestoreResult, type UntrashResult } from "./store.ts";
import { historyRow } from "./versions.ts";

/** The Ledger's `journal`, as the owner's Person reaches it. */
export type JournalSink = (row: JournalRow) => Promise<unknown>;
/** Who acted: the owner's agent through a tool, or the owner in the app. */
export type Actor = "agent" | "person";

export type JournaledDelete = { ok: true; path: string; sharesEnded: number; journaled: boolean; trashed?: boolean } | Exclude<DeleteResult, { ok: true }>;
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
  return { ok: true, path: r.path, sharesEnded: ended.length, journaled, ...(r.trashed ? { trashed: true } : {}) };
}

/** Revokes one share by id, then journals `files.unshare`. */
export async function journaledRevoke(d: { links: PersonLinks; journal?: JournalSink }, id: string, requester: string, by: Actor): Promise<JournaledRevoke> {
  const r = await d.links.revoke(id, requester);
  if (!r.ok) return r;
  const journaled = await write(d.journal, fileRow({ owner: requester, by, actionKind: "files.unshare", subjectRef: `personal;connector:files;resource:file:${r.path}`, at: d.links.at() }));
  return { ...r, journaled };
}

export type JournaledRestore = Extract<RestoreResult, { ok: true }> & { journaled: boolean } | Exclude<RestoreResult, { ok: true }>;
export type JournaledUntrash = Extract<UntrashResult, { ok: true }> & { sharesEnded: number; journaled: boolean } | Exclude<UntrashResult, { ok: true }>;

/** Makes version `n` current again (F103, D-0028 proposed), the replaced current kept as the next version; journals `files.restore`. */
export async function journaledRestore(d: { files: PersonFiles; links: PersonLinks; journal?: JournalSink }, input: { path: string; n: number }, requester: string, by: Actor): Promise<JournaledRestore> {
  const r = await d.files.restoreVersion(input, requester);
  if (!r.ok) return r;
  const journaled = await write(d.journal, historyRow({ owner: requester, by, actionKind: "files.restore", path: r.path, at: d.links.at() }));
  return { ...r, journaled };
}

/**
 * Takes a file out of the trash (F103), then ends any share of its path still standing: a link made before the delete
 * never serves the file again, so a restore is never a re-share. Journals `files.restore`.
 */
export async function journaledUntrash(d: { files: PersonFiles; links: PersonLinks; journal?: JournalSink }, input: { path: string; id?: string }, requester: string, by: Actor): Promise<JournaledUntrash> {
  const r = await d.files.restoreTrashed(input, requester);
  if (!r.ok) return r;
  const ended = await d.links.endSharesOf(r.path);
  const journaled = await write(d.journal, historyRow({ owner: requester, by, actionKind: "files.restore", path: r.path, at: d.links.at() }));
  return { ...r, sharesEnded: ended.length, journaled };
}

/** The owner's calls on their versions and trash (F103, D-0028 proposed), the Person's one RPC entry for them. */
export type HistoryCall =
  | { op: "versions"; path: string }
  | { op: "version"; path: string; n: number }
  | { op: "restore"; path: string; n: number }
  | { op: "trash" }
  | { op: "untrash"; path: string; id?: string }
  | { op: "empty" };

/** Runs one history call for `requester`, every refusal the store's own code. A version opens as text only when it is text. */
export async function historyCall(d: { files: PersonFiles; links: PersonLinks; journal?: JournalSink }, requester: string, call: HistoryCall, by: Actor) {
  const h = d.files.history;
  switch (call?.op) {
    case "versions": {
      const path = parseFilePath(String(call.path ?? ""));
      return path === null ? { ok: false as const, code: "FILES_PATH_INVALID" as const, reason: `not a file path: ${call.path}` } : h.versions(path, requester);
    }
    case "version": {
      const path = parseFilePath(String(call.path ?? ""));
      if (path === null) return { ok: false as const, code: "FILES_PATH_INVALID" as const, reason: `not a file path: ${call.path}` };
      const v = await h.open(path, Number(call.n), requester);
      if (!v.ok) return v;
      const { bytes, ...rest } = v;
      return v.mediaType ? rest : { ...rest, text: new TextDecoder().decode(bytes) };
    }
    case "restore":
      return journaledRestore(d, { path: String(call.path ?? ""), n: Number(call.n) }, requester, by);
    case "trash":
      return h.trash(requester);
    case "untrash":
      return journaledUntrash(d, { path: String(call.path ?? ""), ...(call.id ? { id: String(call.id) } : {}) }, requester, by);
    case "empty":
      return h.empty(requester);
    default:
      return { ok: false as const, code: "FILES_PATH_INVALID" as const, reason: "no such history call" };
  }
}

/**
 * The app's routes for versions and the trash (F103), as one call each, or null for any other path: `GET
 * /app/file/versions?path=`, `GET /app/file/version?path=&n=`, `POST /app/file/restore {path, n}`, `GET /app/trash`,
 * `POST /app/trash/restore {path, id?}`, `POST /app/trash/empty`. The path is a value, never an object id.
 */
export function historyRoute(url: URL, method: string, body: Record<string, unknown>): HistoryCall | null {
  const q = (k: string) => url.searchParams.get(k) ?? "";
  if (method === "GET" && url.pathname === "/app/file/versions") return { op: "versions", path: q("path") };
  if (method === "GET" && url.pathname === "/app/file/version") return { op: "version", path: q("path"), n: Number(q("n")) };
  if (method === "POST" && url.pathname === "/app/file/restore") return { op: "restore", path: String(body.path ?? ""), n: Number(body.n) };
  if (method === "GET" && url.pathname === "/app/trash") return { op: "trash" };
  if (method === "POST" && url.pathname === "/app/trash/restore") return { op: "untrash", path: String(body.path ?? ""), ...(typeof body.id === "string" ? { id: body.id } : {}) };
  if (method === "POST" && url.pathname === "/app/trash/empty") return { op: "empty" };
  return null;
}
