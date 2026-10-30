// The P5 readers over a preview slot (F32): an activity task's world on a real slot with the real model, apart from the
// slot client so a hermetic test reads them without its socket, passkey or browser. Sam's chat `c1` is the trial's; its
// task list and drawer are the app's own routes (`/app/activity`, `/app/activity/<chat>/<turn>`), its thread the history
// the page draws, the system prompts the test host's `p5` op (`scripts/preview-slot/test-host-p5.mjs`), and the rows and
// drawer Sam's page in a real browser (`scripts/evals/p5-page.ts`).
//
// A turn is over for P5 when its task is: a request that delegated is still running until its sub-agents hand off and
// the turn they wake ends (B-P5-08), so `settle` reads the task until it is no longer running.
//
// What the slot cannot see is said, never guessed: a reader no tier-2 grader uses (the tool results the model was shown,
// the Ledger's rows, the jobs, the journal, the tables) throws `SLOT_P5_UNREAD`, and so does a read as Pat, whom the
// slot does not seat.
import { WORK_WORDS } from "../../packages/agent/src/chat/instructions.ts";
import type { ChatLabel, DrawerView, P5World, RowView, RunRow, TaskDetail, TaskView, ThreadEntry } from "../../test/evals/p5-activity/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";

/** Sam's page on the slot, in a real browser: the Activity rows, and a task's drawer opened from its row. */
export interface P5Page {
  rows(): Promise<RowView[]>;
  drawer(chatId: string, id: string, phone: boolean): Promise<DrawerView | null>;
}

/** The P5 world's readers a slot answers (the scenario world's own aside). */
export type P5Readers = Omit<P5World, keyof import("../../test/support/scenario.ts").ScenarioWorld | "during" | "before">;

export interface P5Slot {
  /** Reads the newest task of `c1` until it is no longer running, or until `deadline`; throws `P5_TASK_UNSETTLED` then. */
  settle(deadline: number): Promise<void>;
  readers: P5Readers;
  /** The task as it stood while it ran: not read on a slot. */
  readonly during: P5World["during"];
  /** The tables before the turns: not read on a slot. */
  readonly before: P5World["before"];
}

type Read = (path: string) => Promise<{ status: number; body: unknown }>;

/** How often `settle` reads the task again while it runs. */
export const SETTLE_POLL_MS = 2_000;

const unread = (name: string) => () => {
  throw new Error(`SLOT_P5_UNREAD: ${name} is not read on a slot`);
};

/**
 * The P5 readers over chat `c1`'s id, its history as the page draws it, the app's routes as Sam, the `p5` op's prompts
 * and Sam's page. `wait(ms)` is the poll's pause (a test's resolves at once).
 */
export function p5Slot(c1: () => string, entries: () => SlotEntry[], read: Read, prompts: () => Promise<string[]>, page: P5Page, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), now: () => number = Date.now): P5Slot {
  let seen: string[] = [];
  const label = (chatId: string) => (chatId === c1() ? "c1" : chatId);
  const chatOf = (chat: ChatLabel) => {
    if (chat !== "c1") throw new Error(`SLOT_P5_UNREAD: chat ${chat} is not opened on a slot`);
    return c1();
  };
  const thread = (): ThreadEntry[] => entries().map((e) => ({ kind: e.kind, text: e.text ?? "" }));

  const readers: P5Readers = {
    chatId: (chat = "c1") => chatOf(chat),
    async activity() {
      const r = await read("/app/activity");
      if (r.status !== 200) throw new Error(`P5_ACTIVITY_UNREAD: /app/activity answered ${r.status}`);
      const b = r.body as { tasks?: Array<Omit<TaskView, "chat"> & { chatId: string }>; unread?: Array<{ chatId: string; code: string }>; runs?: RunRow[] };
      return {
        // Sam's list is hers across chats; a trial grades its own chat's tasks, so an earlier trial's chat is left out.
        tasks: (b.tasks ?? []).filter((t) => t.chatId === c1()).map(({ chatId, ...t }) => ({ ...t, chat: label(chatId) }) as TaskView),
        unread: (b.unread ?? []).map((u) => ({ chat: label(u.chatId), code: u.code })),
        runs: (b.runs ?? []).map((x) => ({ title: x.title, word: x.word, code: x.code })),
      };
    },
    async task(chat, id, as = "sam") {
      if (as !== "sam") throw new Error("SLOT_P5_UNREAD: the slot seats Sam alone; a read as Pat is not made");
      const r = await read(`/app/activity/${chatOf(chat)}/${id}`);
      const b = r.body as TaskDetail & { task?: TaskView & { chatId?: string } };
      if (b.task?.chatId) b.task = { ...b.task, chat: label(b.task.chatId) };
      return { ...b, steps: b.steps ?? [], subagents: b.subagents ?? [], usage: b.usage ?? null };
    },
    // The page lists Sam's tasks across chats; a trial's own chat is the newest, so its rows come first.
    rows: () => page.rows(),
    drawer: (chat, id, phone = false) => page.drawer(chatOf(chat), id, phone),
    thread: (chat = "c1") => {
      chatOf(chat);
      return thread();
    },
    replies: (chat = "c1") => {
      chatOf(chat);
      return thread().filter((e) => e.kind === "agent").map((e) => e.text);
    },
    results: unread("results"),
    prompts: () => [...seen],
    instructions: () => WORK_WORDS.split("\n").filter((l) => l.trim()),
    ledgerRows: unread("ledgerRows"),
    dayUsage: unread("dayUsage"),
    priceOf: unread("priceOf"),
    runHistory: unread("runHistory"),
    outbox: unread("outbox"),
    notices: unread("notices"),
    files: unread("files"),
    memoryLines: unread("memoryLines"),
    jobTitles: unread("jobTitles"),
    subagents: unread("subagents"),
    journal: unread("journal"),
    tables: unread("tables"),
    pagesRead: unread("pagesRead"),
  };

  return {
    async settle(deadline) {
      for (;;) {
        const newest = (await readers.activity()).tasks[0];
        if (newest && newest.status !== "running") break;
        if (now() >= deadline) throw new Error(`P5_TASK_UNSETTLED: ${newest ? `the task is still ${newest.status}` : "no task was recorded"}`);
        await wait(SETTLE_POLL_MS);
      }
      seen = await prompts();
    },
    readers,
    get during(): P5World["during"] {
      return unread("during")();
    },
    get before(): P5World["before"] {
      return unread("before")();
    },
  };
}
