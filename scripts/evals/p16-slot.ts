// The P16 readers and events over a preview slot (F81): a shopping task's world on a real slot with the real model, over
// P12's (`p12-slot.ts`, itself over P9's and P5's: the thread, the replies, the calls). Sam's chat `c1` is the trial's;
// the four hosts are the test host's fixture pages (`scripts/preview-slot/test-host-p16.mjs`), and the `p16` op starts
// each trial with Sam's browse memory of them reopened, her memory emptied, her jobs removed and every other chat of hers
// deleted, then reads the chat's stored messages after each turn. The pages read are the browse tools' own results in
// those messages, each with the turn (Sam's message number) it was read in; a handoff is a `browse_handoff` call (the
// slot's browser has no live session, so none can open). `reload` draws the chat's rows at a width, reloads it and
// draws them again (`scripts/evals/p16-page.ts`).
//
// What the slot cannot see is said, never guessed: a P16 reader no tier-2 grader uses throws `SLOT_P16_UNREAD`.
import type { ChatLabel, OrderView, P16SlotWorld, ReadView } from "../../test/evals/p16-shopping-bookings/world.ts";

type Msg = { role: string; content?: unknown; toolName?: string; toolCallId?: string; isError?: boolean };
type Call = { type: string; id?: string; name?: string; arguments?: Record<string, unknown> };

/** One width's drawing of the chat: each row's id and words, in order. */
export interface P16View {
  ids: string[];
  texts: string[];
}

/** Sam's page on the slot, in a real browser. */
export interface P16Page {
  /** The chat drawn at `width`, then reloaded and drawn again. */
  reload(chatId: string, width: "desktop" | "phone"): Promise<{ before: P16View; after: P16View }>;
}

/** The `p16` op: `reset` starts the trial keeping its chat; `read` answers the chat's stored messages. */
export type P16Op = (call: "reset" | "read") => Promise<{ messages: string[] } | null>;

export type P16Readers = Pick<P16SlotWorld, "readLog" | "order" | "memoryText" | "jobStates" | "jobNotices" | "signedIn" | "childCalls" | "handoffs" | "reloads">;

export interface P16Slot {
  readers: P16Readers;
  refresh(): Promise<void>;
  begin(): Promise<void>;
  /** A P16 event (`reload`). False for an event it does not play. */
  event(name: string, payload: Record<string, string>): Promise<boolean>;
}

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const READS = new Set(["browse_open", "browse_live"]);

const unread = (name: string) => () => {
  throw new Error(`SLOT_P16_UNREAD: ${name} is not read on a slot`);
};

/** The pages the chat's browse tools read, in order, each with Sam's message number (1-based) it answered. */
export function readsOf(messages: Msg[]): ReadView[] {
  const calls = new Map<string, Call>();
  const out: ReadView[] = [];
  let turn = 0;
  for (const m of messages) {
    // Sam's messages each carry "(p16 probe)"; a user-role row the runtime adds is no turn of hers.
    if (m.role === "user" && textOf(m.content).includes("(p16 probe)")) turn++;
    if (m.role === "assistant" && Array.isArray(m.content)) for (const c of m.content as Call[]) if (c.type === "toolCall" && c.id) calls.set(c.id, c);
    if (m.role === "toolResult" && READS.has(m.toolName ?? "")) {
      const args = calls.get(m.toolCallId ?? "")?.arguments ?? {};
      out.push({ turn, url: String(args.url ?? args.url_id ?? ""), ok: !m.isError, text: textOf(m.content) });
    }
  }
  return out;
}

/** The `browse_handoff` calls the chat made. */
export function handoffsOf(messages: Msg[]): Array<{ session: string; instructions: string; link: string }> {
  return messages
    .filter((m) => m.role === "assistant" && Array.isArray(m.content))
    .flatMap((m) => (m.content as Call[]).filter((c) => c.type === "toolCall" && c.name === "browse_handoff"))
    .map((c) => ({ session: String(c.arguments?.session ?? ""), instructions: String(c.arguments?.instructions ?? ""), link: "" }));
}

/** The P16 readers over chat `c1`'s id, the `p16` op and Sam's page. */
export function p16Slot(c1: () => string, op: P16Op, page: P16Page): P16Slot {
  let messages: Msg[] = [];
  const views: Awaited<ReturnType<P16SlotWorld["reloads"]>> = [];
  const chatOf = (chat: ChatLabel = "c1") => {
    if (chat !== "c1") throw new Error(`SLOT_P16_UNREAD: chat ${chat} is not opened on a slot`);
  };
  const refresh = async () => {
    messages = ((await op("read"))?.messages ?? []).map((b) => JSON.parse(b) as Msg);
  };
  const readers: P16Readers = {
    readLog: () => readsOf(messages),
    order: (chat?: ChatLabel): OrderView[] => {
      chatOf(chat);
      return unread("order")();
    },
    memoryText: unread("memoryText"),
    jobStates: unread("jobStates"),
    jobNotices: unread("jobNotices"),
    signedIn: unread("signedIn"),
    childCalls: unread("childCalls"),
    handoffs: () => handoffsOf(messages),
    reloads: async () => [...views],
  };
  return {
    readers,
    refresh,
    async begin() {
      await op("reset");
      await refresh();
    },
    async event(name, payload) {
      if (name !== "reload") return false;
      // The first reload also keeps the drawing before it, so the views are: as drawn, after a reload, after one at 375.
      const width = payload.width === "phone" || payload.width === "375" ? "phone" : "desktop";
      const r = await page.reload(c1(), width);
      if (views.length === 0) views.push({ width, ...r.before });
      views.push({ width, ...r.after });
      await refresh();
      return true;
    },
  };
}
