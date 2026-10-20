// The app's pages beyond chat (M14.2): the chat list with the person's main chat, the approvals
// waiting across their chats, the library (their files, MEMORY.md and skills), their jobs with run
// history, and the settings for their loops. The person comes from the verified session and every
// object decides again where the data lives: the `Person` answers only its own person, a `Chat` lists
// cards only to its owner, a `Job` answers only its owner. Writes must come from the app's own page,
// as the vault's and delivery's do. A part that could not be read is said with its code, never shown
// as empty.
import type { CardView } from "../chat/cards.ts";
import type { ChatEntry, ChatsCall } from "../person/chats.ts";
import { JOB_ID } from "../jobs/body.ts";
import type { JobStatus } from "../jobs/store.ts";
import { statusWords } from "../jobs/status-words.ts";
import { nextSlotAfter } from "../jobs/schedule.ts";
import type { JournalRow } from "../grants/journal.ts";
import { notesOf } from "../obs/activity-words.ts";
import { type ConnectorReads, connectorRoutes } from "./connector-routes.ts";
import type { LinkResult, ServedResult } from "../files/links.ts";
import { servedResponse } from "./share-routes.ts";
import { type AttachmentDirectory, attachmentRoutes } from "./attachment-routes.ts";

type Refusal = { ok: false; code: string; reason?: string };

export interface AppJob {
  inspect(by: string): Promise<{ ok: true; job: unknown; runs: Array<Record<string, unknown>> } | Refusal>;
  /** `signal` and `code` say how the run stands when it ended at once (a gate that failed or was blocked). */
  runNow(by: string): Promise<{ ok: true; signal?: string | null; code?: string | null } | Refusal>;
  remove(by: string): Promise<{ ok: true } | Refusal>;
  enable(by: string): Promise<{ ok: true } | Refusal>;
  disable(by: string): Promise<{ ok: true } | Refusal>;
}

export interface AppDirectory extends ConnectorReads {
  chats(person: string, call: ChatsCall): Promise<{ ok: true; main?: string; last?: string; chats?: ChatEntry[]; chatId?: string } | Refusal>;
  /** When one of the person's chats last had something to show (M29.3), answered by that `Chat` for its owner. */
  chatLast(person: string, chatId: string): Promise<{ ok: true; at: number | null } | Refusal>;
  cards(person: string, chatId: string): Promise<CardView[] | null>;
  jobIds(person: string): Promise<string[] | null>;
  job(person: string, id: string): AppJob;
  /** The person's files with the first lines of each small one (M23.4), as their own `Person` lists them. */
  files(person: string): Promise<{ ok: true; files: unknown[] } | Refusal>;
  /** One page of one file's numbered lines; the `Person` decides who may read it and which paths exist. */
  fileRead(person: string, path: string, from: number): Promise<{ ok: true; path: string; size: number; total: number; lines: Array<{ n: number; text: string }>; next: number | null } | Refusal>;
  fileRename(person: string, path: string, to: string): Promise<{ ok: true; path: string; to: string } | Refusal>;
  filePin(person: string, path: string, pinned: boolean): Promise<{ ok: true; path: string; pinned: boolean } | Refusal>;
  fileDelete(person: string, path: string): Promise<{ ok: true; path: string } | Refusal>;
  /** A short-lived signed download or preview link to one of the person's files (M24.3), made by their `Person`. */
  fileLink(person: string, path: string, download: boolean): Promise<LinkResult>;
  /** A signed link presented with the session: the `Person` checks signature, expiry and owner, then serves the bytes. */
  fileLinked(person: string, link: { path: string; exp: string; sig: string }): Promise<ServedResult>;
  loops(person: string): Promise<unknown>;
  /** The person's uploads (M24.3): their `Person` keeps the rows and decides every read; the bytes are in the bucket. */
  attachments?: AttachmentDirectory;
  /** The person's own journal rows, from the Ledger filtered to them (M23.3). */
  activity(person: string): Promise<JournalRow[]>;
  /** One home file read for its owner: its lines and when it last changed. */
  homeFile(person: string, path: "IDENTITY.md" | "SOUL.md" | "MEMORY.md"): Promise<unknown>;
  now(): number;
  setLoop(person: string, loop: unknown, patch: { enabled?: unknown; budget?: unknown }): Promise<unknown>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failed = (r: unknown) => (r as { ok?: boolean }).ok === false;
const statusOf = (code: string) => (/NOT_OWNER|NOT_YOURS/.test(code) ? 403 : /NOT_FOUND|UNKNOWN/.test(code) ? 404 : /MAIN_REFUSED|EXISTS/.test(code) ? 409 : 400);
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Decided cards the Approvals page keeps showing, the latest first. */
export const DECIDED_SHOWN = 20;
/** Runs shown per job: the latest first. */
export const RUNS_SHOWN = 10;
/** Pages of 200 lines one file read walks; a file longer than this is answered `complete: false`, never as whole. */
export const FILE_PAGES = 100;

/** The types a file is served as, by extension; anything else is plain text. A download is never sniffed or run. */
export const FILE_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8", markdown: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", html: "text/plain; charset=utf-8",
  htm: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8", json: "text/plain; charset=utf-8", pdf: "application/pdf", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

/** A file's lines read to the end or to the page bound, so the caller says whether it holds the whole file. */
async function wholeFile(dir: AppDirectory, person: string, path: string) {
  let from = 1;
  const lines: string[] = [];
  for (let page = 0; page < FILE_PAGES; page++) {
    const r = await dir.fileRead(person, path, from);
    if (r.ok === false) return r;
    for (const l of r.lines) lines.push(l.text);
    if (r.next === null) return { ok: true as const, path: r.path, size: r.size, text: lines.join("\n"), complete: true };
    from = r.next;
  }
  return { ok: true as const, path, size: 0, text: lines.join("\n"), complete: false };
}

/** Settled reads: each part is its value or its refusal code, so one failure does not blank the page. */
async function part<T>(read: () => Promise<T>): Promise<T | { ok: false; code: string }> {
  try {
    return await read();
  } catch (e) {
    return { ok: false, code: "APP_READ_FAILED", reason: String(e).slice(0, 200) } as { ok: false; code: string };
  }
}

export async function appRoutes(request: Request, url: URL, person: string, dir: AppDirectory | undefined): Promise<Response | null> {
  if (!url.pathname.startsWith("/app/")) return null;
  if (!dir) return json({ code: "NOT_FOUND" }, 404);
  const write = request.method !== "GET";
  if (write && request.headers.get("origin") !== url.origin) return json({ code: "APP_ORIGIN" }, 403);
  // An upload is multipart, so it is answered before the JSON body is read (M24.3).
  const attached = await attachmentRoutes(request, url, person, dir.attachments);
  if (attached) return attached;
  const body = write ? (((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>) : {};
  const answer = (r: unknown, status = 200) => (failed(r) ? json(r, statusOf((r as Refusal).code)) : json(r, status));

  if (url.pathname === "/app/chats" && request.method === "GET") {
    // The Person says which chats are the person's; each Chat says, for its owner, when it last had something to
    // show (M29.3). A time that could not be read carries its code and no time, never a time of its own.
    const view = await dir.chats(person, { op: "view" });
    if (failed(view) || !view.ok || !view.chats) return answer(view);
    const chats = await Promise.all(view.chats.map(async (c) => {
      const last = await part(() => dir.chatLast(person, c.id));
      return last.ok ? { ...c, lastAt: last.at } : { ...c, lastAt: null, lastCode: last.code };
    }));
    return answer({ ...view, chats });
  }
  if (url.pathname === "/app/chats" && request.method === "POST") return answer(await dir.chats(person, { op: "open", title: body.title }), 201);
  const chat = /^\/app\/chats\/([^/]+)(?:\/(archive|rename))?$/.exec(url.pathname);
  if (chat) {
    const id = chat[1] as string;
    if (!CHAT_ID.test(id)) return json({ code: "CHAT_NOT_FOUND" }, 404);
    if (request.method === "DELETE" && !chat[2]) return answer(await dir.chats(person, { op: "delete", id }));
    if (request.method === "POST" && chat[2] === "archive") return answer(await dir.chats(person, { op: "archive", id, archived: body.archived !== false }));
    if (request.method === "POST" && chat[2] === "rename") return answer(await dir.chats(person, { op: "rename", id, title: body.title }));
  }

  if (url.pathname === "/app/approvals" && request.method === "GET") {
    const listed = await dir.chats(person, { op: "view" });
    if (failed(listed) || !("chats" in listed)) return answer(listed);
    const out: Array<CardView & { chatId: string; chatTitle: string }> = [];
    const decided: typeof out = [];
    const unread: Array<{ chatId: string; code: string }> = [];
    // The chats are read together (a person's chats add up: one after another took seconds on staging) and
    // sorted back into the list's order, so the answer is the same as before.
    const read = await Promise.all((listed.chats ?? []).map(async (c) => ({ c, cards: await part(() => dir.cards(person, c.id)) })));
    for (const { c, cards } of read) {
      if (cards === null || failed(cards)) unread.push({ chatId: c.id, code: cards === null ? "CHAT_NOT_FOUND" : (cards as Refusal).code });
      else for (const card of cards as CardView[]) (card.state === "pending" || card.state === "deciding" ? out : decided).push({ ...card, chatId: c.id, chatTitle: c.title });
    }
    // A decided card stays on the page with its outcome in words (M20.1, QYVR-173): the latest few.
    return json({ ok: true, cards: out, decided: decided.slice(-DECIDED_SHOWN).reverse(), unread });
  }

  if (url.pathname === "/app/library" && request.method === "GET") {
    // The person's own files alone (M23.4): memory is the sheet's Profile and skills are the workshop's.
    return json({ ok: true, files: await part(() => dir.files(person)) });
  }

  // One file of the person's home tree. The path is a query value or a body value, never an object id, and
  // the `Person` refuses any path outside the person's `files/` tree, so a route cannot name another's.
  if (url.pathname === "/app/file" && request.method === "GET") {
    const r = await part(() => wholeFile(dir, person, url.searchParams.get("path") ?? ""));
    return answer(r);
  }
  if (url.pathname === "/app/file/link" && request.method === "GET") {
    return answer(await part(() => dir.fileLink(person, url.searchParams.get("path") ?? "", url.searchParams.get("download") === "1")));
  }
  if (url.pathname === "/app/file/raw" && request.method === "GET") {
    // Every download and preview is by a short-lived signed link (M24.3), presented with the session: the
    // session's own `Person` checks the signature, the expiry and the owner, so a link made for anyone else,
    // or none at all, is refused. The Library asks `/app/file/link` for one each time it shows a file.
    if (!url.searchParams.has("sig") && !url.searchParams.has("exp")) return json({ ok: false, code: "LINK_REQUIRED", reason: "open the file from the Library, which asks for a link" }, 403);
    const link = { path: url.searchParams.get("path") ?? "", exp: url.searchParams.get("exp") ?? "", sig: url.searchParams.get("sig") ?? "" };
    const served = await part(() => dir.fileLinked(person, link));
    return servedResponse(served as ServedResult, { download: url.searchParams.get("download") === "1" });
  }
  if (url.pathname === "/app/file/rename" && request.method === "POST") return answer(await part(() => dir.fileRename(person, String(body.path ?? ""), String(body.to ?? ""))));
  if (url.pathname === "/app/file/pin" && request.method === "POST") return answer(await part(() => dir.filePin(person, String(body.path ?? ""), body.pinned !== false)));
  if (url.pathname === "/app/file/delete" && request.method === "POST") return answer(await part(() => dir.fileDelete(person, String(body.path ?? ""))));

  if (url.pathname === "/app/activity" && request.method === "GET") {
    // The Ledger is asked for this session's person alone; nothing in the request names another.
    const rows = await part(() => dir.activity(person));
    return json(Array.isArray(rows) ? { ok: true, notes: notesOf(rows) } : rows);
  }

  if (url.pathname === "/app/profile" && request.method === "GET") {
    const [identity, soul, memory] = await Promise.all((["IDENTITY.md", "SOUL.md", "MEMORY.md"] as const).map((f) => part(() => dir.homeFile(person, f))));
    return json({ ok: true, identity, soul, memory });
  }

  if (url.pathname === "/app/jobs" && request.method === "GET") {
    const ids = await dir.jobIds(person);
    if (!ids) return json({ code: "JOBS_NOT_OWNER" }, 403);
    const jobs = [];
    for (const id of ids) {
      const s = await part(() => dir.job(person, id).inspect(person));
      const job = failed(s) ? null : ((s as { job: { status?: JobStatus } | null }).job ?? null);
      // The job's status in the one table's words (M20.1), so the page says what the job tools say.
      const timing = (job as { def?: { timing?: Parameters<typeof nextSlotAfter>[0] } } | null)?.def?.timing;
      const live = job?.status === "active" || job?.status === "blocked";
      // The Reminders tab's grouping and next run, from the job's own schedule (M23.3).
      const title = (job as { def?: { title?: string } } | null)?.def?.title ?? "";
      const kind = timing?.schedule.kind ?? null;
      const nextRun = timing && live ? nextSlotAfter(timing, dir.now?.() ?? Date.now()) : null;
      jobs.push(failed(s) ? { id, ok: false, code: (s as Refusal).code } : { id, ok: true, job, words: job?.status ? statusWords(job.status) : "", title, kind, nextRun, runs: (s as { runs: unknown[] }).runs.slice(-RUNS_SHOWN).reverse() });
    }
    return json({ ok: true, jobs });
  }
  const job = /^\/app\/jobs\/([^/]+)$/.exec(url.pathname);
  if (job && request.method === "POST") {
    const id = job[1] as string;
    if (!JOB_ID.test(id)) return json({ code: "JOB_ID_INVALID" }, 400);
    const stub = dir.job(person, id);
    const action = body.action;
    const r = action === "run" ? await stub.runNow(person) : action === "enable" ? await stub.enable(person) : action === "disable" ? await stub.disable(person) : action === "remove" ? await stub.remove(person) : { ok: false as const, code: "JOB_ACTION_INVALID", reason: "run, enable, disable or remove" };
    return answer(r);
  }

  if (url.pathname === "/app/loops" && request.method === "GET") return answer(await dir.loops(person));
  const reads = await connectorRoutes(request, url, person, dir);
  if (reads) return reads;

  if (url.pathname === "/app/loops" && request.method === "POST") return answer(await dir.setLoop(person, body.loop, { enabled: body.enabled, budget: body.budget }));
  return json({ code: "NOT_FOUND" }, 404);
}
