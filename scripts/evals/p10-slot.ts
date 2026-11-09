// The P10 readers over a preview slot (F91): a search, browser or media task's world on a real slot with the real model,
// apart from the slot client so a hermetic test reads them without its socket or passkey. Sam's chat `c1` is the
// trial's. The tool calls the model made and the results it was shown are the chat's stored messages, and Sam's files
// her file list, both through the test host's `p9` op (`scripts/preview-slot/test-host-p9.mjs`, read only: P10 resets
// nothing of Sam's credentials); the browser's record is the chat's log from the `state` op, each read with its whole
// address (`scripts/preview-slot/test-host-sites.mjs`). A task's `https://<slot>` (the slot's own origin, F91's probe
// pages, `scripts/preview-slot/test-host-p10.mjs`) is written as the slot's origin before the prompt is sent.
//
// Sam's files are counted from the trial's start: the slot keeps every earlier trial's files, so `files()` is what the
// trial added ("Sam's files listed before the turn", T-P10-11). What the slot cannot see is said, never guessed: a reader
// no tier-2 grader uses (the fake browser's sessions, browse memory, the Ledger, the Vault, a reload) throws
// `SLOT_P10_UNREAD`, and so does a read of a chat other than `c1`.
import type { P10World } from "../../test/evals/p10-search/world.ts";

/** What the `p9` op's read and the `state` op's log give a P10 grader. */
export interface P10State {
  messages: string[];
  files: string[];
  reads: Array<{ host: string; url?: string }>;
}

export type P10Readers = Pick<P10World, "replies" | "calls" | "results" | "files" | "browserLog">;

export interface P10Slot {
  readers: P10Readers;
  /** The trial's start: Sam's files as they stand, so `files()` counts only the trial's own. */
  begin(): Promise<void>;
  /** Reads `c1`'s rows again. */
  refresh(): Promise<void>;
}

/** The slot's own origin in a task's prompt (`SLOT` in test/evals/p10-search/page-orders-real-model.task.ts). */
export const SLOT_ORIGIN = "https://<slot>";

/** `text` with the task's `https://<slot>` written as the slot's origin. */
export const onSlot = (text: string, origin: string): string => text.split(SLOT_ORIGIN).join(origin);

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean };

const unread = (name: string) => {
  throw new Error(`SLOT_P10_UNREAD: ${name} is not read on a slot`);
};

/** The P10 readers over the trial's replies and the slot's state; `read()` answers the `p9` op's and the `state` op's reads. */
export function p10Slot(replies: () => string[], read: () => Promise<P10State>): P10Slot {
  let state: P10State = { messages: [], files: [], reads: [] };
  let before: Set<string> = new Set();
  const c1 = (chat: string = "c1") => {
    if (chat !== "c1") unread(`chat ${chat}`);
  };
  const messages = () => state.messages.map((b) => JSON.parse(b) as Msg);
  const readers: P10Readers = {
    replies: (chat = "c1") => {
      c1(chat);
      return [...replies()];
    },
    calls: () =>
      messages()
        .filter((m) => m.role === "assistant" && Array.isArray(m.content))
        .flatMap((m) => (m.content as Array<{ type: string; name?: string; arguments?: Record<string, unknown> }>).filter((c) => c.type === "toolCall").map((c) => ({ tool: String(c.name), args: c.arguments ?? {} }))),
    results: (chat = "c1") => {
      c1(chat);
      return messages()
        .filter((m) => m.role === "toolResult")
        .map((m) => ({ tool: m.toolName ?? "", text: textOf(m.content), isError: !!m.isError }));
    },
    files: async () => state.files.filter((f) => !before.has(f)),
    browserLog: () => ({ reads: state.reads.map((r) => ({ url: r.url ?? `https://${r.host}/`, engine: "test-host" })), sessions: [], gotos: [] }),
  } as P10Readers;
  return {
    readers,
    async begin() {
      state = await read();
      before = new Set(state.files);
    },
    async refresh() {
      state = await read();
    },
  };
}
