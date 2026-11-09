// The P11 readers over a preview slot (F102): T-P11-16, T-P11-17 and T-P11-18 on a real slot with the real model,
// apart from the slot client so a hermetic test reads them without its socket or passkey. What they read:
//   files      Sam's Library through `/app/library`, each text file's words through `/app/file` (the Person decides);
//   entries    chat c1's stored messages through the test host's `p11` op (./test-host-p11.mjs): Sam's message, each tool
//              call with its arguments, each tool's result and the agent's words, in order, as the tier-1 world gives them;
//   shares     Sam's live shares through `/app/shares`; cards and links from the chat's history as the page draws it;
//   answers    the share link's public answer, asked with no session at all (`/hooks/share/<id>.<sig>`).
// A trial begins with Sam's Library emptied through `/app/file/delete` (which ends every share of a file), then the task's
// setup: T-P11-17's memo seeded by the `p11` op at the path its grader reads, the slot having no Renderer (D-0031, proposed). The `approve` event
// (P11 only) decides the chat's pending card `once` through the page's route, with the counts taken either side of it.
// A reading the tier-2 tasks never make (the R2 pointers, the journal, the renders, the egress) throws by name: the
// slot answers it nowhere, so it is never given as empty.
import { strToU8, zipSync } from "fflate";
import type { SlotEntry } from "../../test/support/evals.ts";
import { type Answer, type CardSeen, type Entry, type FileRow, type LinkSeen, MEMO_DOCX, type P11World } from "../../test/evals/p11-files/world.ts";

type Read = (path: string) => Promise<{ status: number; body: unknown }>;
type Post = (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;

export interface P11SlotDeps {
  /** An app route as Sam. */
  read: Read;
  post: Post;
  /** A request with no session at all, as anyone with a link would make it. */
  publicGet: (path: string) => Promise<{ status: number; text: string }>;
  /** Chat c1's history as the page draws it, after the last turn. */
  history: () => SlotEntry[];
  /** The test host's `p11` op: the seed, or chat c1's entries. */
  op: (call: "seed" | "entries", args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** A decision on one of chat c1's cards through the page's route, waited out to the turn it continues. */
  decide: (cardId: string, choice: string) => Promise<void>;
}

/**
 * T-P11-17's memo, in Sam's Library before the turns: at the path its "memo is unchanged" grader reads (`MEMO_DOCX`,
 * `documents/p11-memo.docx`), so that grader measures the seeded bytes, and the contract's setup line names the same path
 * since 2026-11-09. The task file's own `setup.records` still says `documents/p11-eval-memo.docx` (F102, the verifier's
 * finding; Reconcile in PR #171): it is hash-pinned and moves with the P11 rerun.
 */
export const P11_SLOT_MEMO = MEMO_DOCX;
/** The choice the runner approves a card with: allow once (a share's card offers no lasting one). */
export const APPROVE_CHOICE = "once";

/** A small docx whose words are the memo's: the seed, since the slot's Renderer is off. */
export function memoDocx(): Uint8Array {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${["p11 eval memo", "Plan: Solo Sam ships the plan next quarter.", "Numbers: invented.", "Next: review."].map(para).join("")}</w:body></w:document>`),
  });
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

interface Listed {
  path: string;
  size: number;
  sha256: string;
  updated_at: number;
  mediaType?: string;
}

/** The Library's rows from `/app/library`, whose `files` is the Person's answer (its own `files`, or its refusal). */
async function library(read: Read): Promise<Listed[]> {
  const r = await read("/app/library");
  const inner = (r.body as { files?: { ok?: boolean; files?: Listed[]; code?: string } }).files;
  if (r.status !== 200 || !inner || inner.ok === false || !Array.isArray(inner.files)) throw new Error(`P11_LIBRARY_UNREAD: /app/library answered ${r.status} ${inner?.code ?? ""}`.trim());
  return inner.files;
}

export interface P11Slot {
  readers: Omit<P11World, "snapshot">;
  /** The trial's start: the Library emptied, the task's setup made, the rows read. */
  begin(taskId: string): Promise<void>;
  /** Everything read again after a turn; after a prompt that follows an approval, the share's public answer too. */
  refresh(after?: "prompt" | "event"): Promise<void>;
  /** A P11 event: `approve`, the pending card allowed once. False for any other event. */
  event(name: string): Promise<boolean>;
}

const unread = (what: string) => () => {
  throw new Error(`P11_SLOT_UNREAD: ${what} is read on tier 1 only; the slot answers it nowhere`);
};

export function p11Slot(deps: P11SlotDeps): P11Slot {
  let rows: FileRow[] = [];
  let before: FileRow[] = [];
  let entries: Entry[] = [];
  let shares: Array<{ id: string; path: string; sha256: string; expiresAt: number }> = [];
  let approved = false;
  const answers: Record<string, Answer> = {};
  const at: P11World["at"] = {};

  const readFiles = async (): Promise<FileRow[]> => {
    const out: FileRow[] = [];
    for (const f of await library(deps.read)) {
      let text: string | null = null;
      if (!f.mediaType) {
        const r = await deps.read(`/app/file?path=${encodeURIComponent(f.path)}`);
        const b = r.body as { ok?: boolean; text?: string; complete?: boolean; code?: string };
        if (r.status !== 200 || b.ok !== true || typeof b.text !== "string" || b.complete !== true) throw new Error(`P11_FILE_UNREAD: ${f.path} answered ${r.status} ${b.code ?? ""}`.trim());
        text = b.text;
      }
      out.push({ path: f.path, size: f.size, sha256: f.sha256, mediaType: f.mediaType ?? null, updatedAt: f.updated_at, text });
    }
    return out;
  };
  const readShares = async () => {
    const r = await deps.read("/app/shares");
    const b = r.body as { ok?: boolean; shares?: Array<{ id: string; path: string; expiresAt: number; expired?: boolean }>; code?: string };
    if (r.status !== 200 || b.ok !== true || !Array.isArray(b.shares)) throw new Error(`P11_SHARES_UNREAD: /app/shares answered ${r.status} ${b.code ?? ""}`.trim());
    // The route gives no sha; a share is bound to its file's, which `files()` carries.
    return b.shares.filter((s) => !s.expired).map((s) => ({ id: s.id, path: s.path, sha256: "", expiresAt: s.expiresAt }));
  };
  const cards = (): CardSeen[] => deps.history().flatMap((e) => (e.kind === "card" && e.card ? [{ state: e.card.state, title: e.card.title, lines: [], choices: [] }] : []));
  const links = (): LinkSeen[] =>
    deps.history().flatMap((e) => {
      const c = (e as unknown as { card?: { kind?: string; title?: string; text?: string; href?: string } }).card;
      return e.kind === "link" && c ? [{ kind: String(c.kind ?? ""), title: String(c.title ?? ""), text: String(c.text ?? ""), href: String(c.href ?? "") }] : [];
    });
  const readEntries = async () => ((await deps.op("entries")).entries as Entry[] | undefined) ?? [];
  const mark = (name: string) => {
    // `pointers` is R2's, which the slot does not list: -1 says it was not read.
    at[name] = { shares: shares.length, pointers: -1, pending: cards().filter((c) => c.state === "pending").length, links: links().length };
  };
  const keep = (name: string, who: Answer["who"], res: { status: number; text: string }) => {
    let code: string | null = null;
    try {
      code = (JSON.parse(res.text) as { code?: string }).code ?? null;
    } catch {}
    answers[name] = { who, status: res.status, code, body: res.text };
  };
  const shareHref = () => links().find((l) => l.kind === "share")?.href ?? null;
  const refresh = async (after?: "prompt" | "event") => {
    rows = await readFiles();
    shares = await readShares();
    entries = await readEntries();
    // After the approval, the link the chat drew is asked again with no session after each prompt: the revoke's proof.
    const href = answers.link?.body;
    if (after === "prompt" && approved && href) keep("revoked", "none", await deps.publicGet(href));
  };

  const readers: Omit<P11World, "snapshot"> = {
    get before() {
      return before;
    },
    files: () => rows,
    entries: () => entries,
    cards,
    links,
    shares: () => shares,
    pointers: unread("the R2 share pointers"),
    journal: unread("the Ledger's journal"),
    journalText: unread("the Ledger's journal"),
    answers,
    at,
    get renders(): never {
      return unread("the Renderer's requests")();
    },
    get egress(): never {
      return unread("the deploy's egress")();
    },
    get liveExpr(): never {
      return unread("the chat page's source")();
    },
    get listing(): never {
      return unread("the file_list listing")();
    },
  };

  return {
    readers,
    async begin(taskId) {
      for (const f of await library(deps.read)) {
        const r = await deps.post("/app/file/delete", { path: f.path });
        if (r.status !== 200) throw new Error(`P11_RESET_FAILED: ${f.path} answered ${r.status}`);
      }
      if (taskId === "T-P11-17") {
        const r = await deps.op("seed", { seed: { path: P11_SLOT_MEMO, base64: b64(memoDocx()) } });
        if (r.ok !== true) throw new Error(`P11_SEED_FAILED: ${String(r.code ?? "")}`);
      }
      await refresh();
      before = rows;
    },
    refresh,
    async event(name) {
      if (name !== "approve") return false;
      mark("before-approval");
      const card = deps.history().find((e) => e.kind === "card" && e.card?.state === "pending")?.card;
      if (!card) throw new Error("P11_NO_PENDING_CARD: the chat has no pending card to approve");
      await deps.decide(card.id, APPROVE_CHOICE);
      approved = true;
      await refresh("event");
      mark("after-approval");
      const href = shareHref();
      if (href) answers.link = { who: "sam", status: 200, code: null, body: href };
      return true;
    },
  };
}
