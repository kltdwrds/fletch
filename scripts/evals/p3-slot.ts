// The P3 readers and events over a preview slot (F34): a delegation task's world on a real slot with the real model,
// beside P5's (`p5-slot.ts`: the Activity route, the drawer route, the thread, the prompts), apart from the slot client
// so a hermetic test reads them without its socket, passkey or browser. Sam's chat `c1` is the trial's; its sub-agent
// rows, mailbox rows and model requests are the test host's `p3` op (`scripts/preview-slot/test-host-p3.mjs`), its
// drawer sections and thread Sam's page in a real browser (`scripts/evals/p3-page.ts`).
//
// A request is over for P3 when nothing it started is still out: the newest task of `c1` no longer running (P5's rule),
// no sub-agent row queued, running or waiting, and every row's group handed off (`settle`), so a closed child still
// reading its slow page and a handoff not yet in the chat are waited out too. An older task is not waited for: after a steer its task reads running
// still, its closed delegation handed off (`packages/agent/src/chat/activity.ts`, Q28). The events:
//   - `midchild` (payload `text` or `stop`): once a child of `c1` is seen mid-run (its row running with a step in its
//     drawer, or settled first, which T-P3-15 answers as "already finished"), Sam sends `text` as a turn, or presses the
//     Stop of the oldest running task through the drawer's route; then everything is waited out;
//   - `children`: everything waited out;
//   - `reload`: the entries and the rows kept as they stood, then read again from the slot.
//
// What the slot cannot see is said, never guessed: a reader no tier-2 grader uses (a child's transcript and requests,
// the Ledger, the planted effects, Pat's chat, the job's results, the chunk index, the retry, the held view) throws
// `SLOT_P3_UNREAD`, and so does a read of a chat other than `c1`.
import type { ChildRow, DrawnSection, MailView, P3World, ThreadDom } from "../../test/evals/p3-delegation/world.ts";
import type { ChatLabel, TaskDetail, TaskView } from "../../test/evals/p5-activity/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";
import { P3_TITLE } from "../preview-slot/test-host-p3.mjs";
import type { P5Readers } from "./p5-slot.ts";

/** Sam's page on the slot, in a real browser: a task's drawer sections, and the thread. */
export interface P3Page {
  sections(chatId: string, taskId: string, phone: boolean): Promise<DrawnSection[]>;
  threadDom(chatId: string, phone: boolean): Promise<ThreadDom>;
}

/** What the test host's `p3` op answers for a chat. */
export interface P3State {
  children: ChildRow[];
  mailbox: MailView[];
  requests: string[];
}

/** The P3 world's own readers a slot answers (P5's come from `p5Slot`). */
export type P3Readers = Omit<P3World, keyof P5Readers | keyof import("../../test/support/scenario.ts").ScenarioWorld | "during" | "before">;

export interface P3Slot {
  readers: P3Readers;
  /** Reads `c1`'s rows again. */
  refresh(): Promise<void>;
  /** Waits until the newest task of `c1` is not running, no sub-agent row is out and every row's group has handed off, or until `deadline`; throws `P3_UNSETTLED` then. */
  settle(deadline: number): Promise<void>;
  /** A P3 event (`midchild`, `children`, `reload`); `send` sends Sam's text as a turn. False for an event it does not play. */
  event(name: string, payload: Record<string, string>, send: (text: string) => Promise<unknown>, deadline: number): Promise<boolean>;
}

type Read = (path: string, method?: "GET" | "POST") => Promise<{ status: number; body: unknown }>;

/** How often a wait reads the slot again. */
export const POLL_MS = 2_000;
const OUT = new Set(["queued", "running", "waiting"]);

const unread = (name: string) => () => {
  throw new Error(`SLOT_P3_UNREAD: ${name} is not read on a slot`);
};

/**
 * The P3 readers over chat `c1`'s id, its history as the page draws it, the app's routes as Sam, the `p3` op and Sam's
 * page. `wait(ms)` is the poll's pause (a test's resolves at once).
 */
export function p3Slot(c1: () => string, entries: () => SlotEntry[], read: Read, op: () => Promise<P3State>, page: P3Page, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), now: () => number = Date.now): P3Slot {
  let state: P3State = { children: [], mailbox: [], requests: [] };
  let reloaded: P3World["reloaded"] = null;
  const chatOf = (chat: ChatLabel = "c1") => {
    if (chat !== "c1") throw new Error(`SLOT_P3_UNREAD: chat ${chat} is not opened on a slot`);
    return c1();
  };
  const entryIds = () => entries().map((e) => `${e.kind}:${e.mid ?? e.turn ?? ""}`);
  const children = () => state.children;
  const tasks = async (): Promise<Array<Omit<TaskView, "chat"> & { chatId: string }>> => {
    const r = await read("/app/activity");
    if (r.status !== 200) throw new Error(`P3_ACTIVITY_UNREAD: /app/activity answered ${r.status}`);
    return ((r.body as { tasks?: Array<Omit<TaskView, "chat"> & { chatId: string }> }).tasks ?? []).filter((t) => t.chatId === c1());
  };
  const refresh = async () => {
    state = await op();
  };
  const settle = async (deadline: number) => {
    for (;;) {
      await refresh();
      const newest = (await tasks())[0];
      const out = state.children.filter((c) => OUT.has(c.status) || c.handedOffAt === null);
      if (newest?.status !== "running" && !out.length) return;
      if (now() >= deadline) throw new Error(`P3_UNSETTLED: the newest task is ${newest?.status ?? "unrecorded"} and ${out.length} sub-agent(s) are out or not handed off`);
      await wait(POLL_MS);
    }
  };
  /** A child of `c1` mid-run: a running row with a step in its drawer; or none out any more (it settled first). */
  const midRun = async (deadline: number) => {
    for (;;) {
      for (const t of (await tasks()).filter((x) => x.status === "running")) {
        const d = (await read(`/app/activity/${c1()}/${t.id}`)).body as TaskDetail;
        const rows = (d.subagents ?? []).flatMap((s) => s.rows);
        if (rows.some((r) => r.status === "running" && Array.isArray(r.steps) && r.steps.length > 0)) return;
      }
      await refresh();
      if (state.children.length && !state.children.some((c) => OUT.has(c.status))) return;
      if (now() >= deadline) throw new Error("P3_NO_CHILD_MIDRUN: no sub-agent of the chat was seen mid-run");
      await wait(POLL_MS);
    }
  };

  const readers: P3Readers = {
    probeTitle: P3_TITLE,
    children: (chat) => {
      chatOf(chat);
      return children();
    },
    mailbox: (chat) => {
      chatOf(chat);
      return state.mailbox;
    },
    get retried(): P3World["retried"] {
      return unread("retried")();
    },
    childMessages: async () => unread("childMessages")(),
    requests: (chat) => {
      chatOf(chat);
      return [...state.requests];
    },
    childRequests: unread("childRequests"),
    threadDom: (chat, phone = false) => page.threadDom(chatOf(chat), phone),
    sections: (chat, id, phone = false) => page.sections(chatOf(chat), id, phone),
    ledgerCalls: async () => unread("ledgerCalls")(),
    effects: unread("effects"),
    get held(): P3World["held"] {
      return unread("held")();
    },
    entryIds: (chat) => {
      chatOf(chat);
      return entryIds();
    },
    get reloaded() {
      return reloaded;
    },
    patChildren: unread("patChildren"),
    jobResults: unread("jobResults"),
    chunkLines: unread("chunkLines"),
  };

  return {
    readers,
    refresh,
    settle,
    async event(name, payload, send, deadline) {
      if (name === "children") await settle(deadline);
      else if (name === "midchild") {
        await midRun(deadline);
        if (payload.text) await send(payload.text);
        if (payload.stop) {
          // The task whose child is out: the chat's oldest still running, its Stop the drawer's.
          const t = (await tasks()).filter((x) => x.status === "running").at(-1);
          if (t) {
            const r = await read(`/app/activity/${c1()}/${t.id}/stop`, "POST");
            const code = (r.body as { ok?: boolean; code?: string }).code;
            if (r.status !== 200 || (r.body as { ok?: boolean }).ok === false) throw new Error(`P3_STOP_REFUSED: the drawer's Stop answered ${r.status} ${code ?? ""}`);
          }
        }
        await settle(deadline);
      } else if (name === "reload") {
        reloaded = { entries: entryIds(), statuses: children().map((c) => `${c.id}:${c.status}:${c.code ?? ""}`) };
      } else return false;
      return true;
    },
  };
}
