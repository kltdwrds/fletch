// The P12 readers and events over a preview slot (F39): a payments task's world on a real slot with the real model,
// over P9's (`p9-slot.ts`: the thread, the replies, Sam's typed rows, the stored rows, what the model was sent, the two
// tabs) and P5's (`p5-slot.ts`: the Activity routes), apart from the slot client so a hermetic test reads them without
// its socket, passkey or browser. Sam's chat `c1` is the trial's; its cards with their words, her authority grants, her
// journal rows and her jobs are the test host's `p12` op (`scripts/preview-slot/test-host-p12.mjs`); the effects that
// ran are the test host's egress log (the slot's one fixture effect, `share_post`; no purchase tool exists there); the
// chat reloaded at two widths and `/settings` are Sam's page in a real browser (`scripts/evals/p12-page.ts`).
//
// Each trial begins with Sam's grant rows deleted (`begin`, beside P9's reset of her credential and typed rows); the
// journal rows and jobs a grader counts are the trial's own, those there before it left out. T-P12-13 is played after
// T-P12-10's ask and T-P12-11's typed card in its own chat. The events:
//   - `reload` (payload `width`): the chat drawn at that width, then reloaded and drawn again; after an `open`, the
//     opened page reloaded instead;
//   - `open` (payload `path`, `width`): that settings page opened at that width;
//   - `tabs` is P9's.
//
// What the slot cannot see is said, never guessed: a reader no tier-2 grader uses (the Approvals tab, the decisions,
// the commits, the proposals, a job's calls, Sam's stores, the handoffs) throws `SLOT_P12_UNREAD`, and so does a read
// of a chat other than `c1`.
import type { P5World, TaskDetail, TaskView } from "../../test/evals/p5-activity/world.ts";
import card from "../../test/evals/p12-wallet/card-typed-real-model.task.ts";
import refused from "../../test/evals/p12-wallet/purchase-refused-by-name-real-model.task.ts";
import type { CardWords, ChatLabel, GrantRow, JournalView, P12SlotWorld, StepRow } from "../../test/evals/p12-wallet/world.ts";

/** What the test host's `p12` op answers for a chat. */
export interface P12State {
  cards: CardWords[];
  grants: GrantRow[];
  journal: JournalView[];
  jobs: Array<{ id: string; title: string }>;
}

/** What one width of the chat draws: the agent's bubbles, in order, and Sam's bubble of her typed card. */
export interface P12View {
  replies: string[];
  masked: string | null;
}

/** Sam's page on the slot, in a real browser. */
export interface P12Page {
  /** The chat drawn at `width`, then reloaded and drawn again, with the origin of every request the page made. */
  reload(chatId: string, width: "desktop" | "phone"): Promise<{ before: P12View; after: P12View; origins: string[] }>;
  /** `path` loaded at `width`: whether the Settings dialog drew, its panes and its heading, with every request's origin. */
  settings(path: string, width: "desktop" | "phone"): Promise<{ drawn: boolean; panes: string[]; heading: string; origins: string[] }>;
}

/** The P12 world's own readers a slot answers, its slot readers and the jobs' titles; the rest are P9's and P5's. */
export type P12Readers = Omit<P12SlotWorld, Exclude<keyof P5World, "jobTitles"> | keyof import("../../test/evals/p9-connectors/world.ts").P9World> & Pick<P12SlotWorld, "jobTitles" | "reloads" | "settingsAtPhone" | "origins" | "origin">;

export interface P12Slot {
  readers: P12Readers;
  /** Reads `c1`'s rows again. */
  refresh(): Promise<void>;
  /** A trial's start: Sam's grant rows deleted, what was there before kept aside, then the task's setup (T-P12-13: T-P12-10 and 11 played). */
  begin(taskId: string, send: (text: string) => Promise<unknown>): Promise<void>;
  /** A P12 event (`reload`, `open`). False for an event it does not play. */
  event(name: string, payload: Record<string, string>): Promise<boolean>;
}

/** The `p12` op: `reset` deletes Sam's grant rows; `read` answers the chat's state. */
export type P12Op = (call: "reset" | "read") => Promise<P12State | null>;
/** The Activity routes as P5's readers answer them. */
export type Activity = { activity(): Promise<{ tasks: TaskView[] }>; task(chat: ChatLabel, id: string): Promise<TaskDetail> };

const EMPTY: P12State = { cards: [], grants: [], journal: [], jobs: [] };

const unread = (name: string) => () => {
  throw new Error(`SLOT_P12_UNREAD: ${name} is not read on a slot`);
};

/** The texts T-P12-13's setup sends first: T-P12-10's ask, then T-P12-11's typed card. */
export const BEFORE_T13 = [refused.turns[0]?.kind === "prompt" ? refused.turns[0].text : "", card.turns[0]?.kind === "event" ? String(card.turns[0].payload?.text) : ""];

/**
 * The P12 readers over chat `c1`'s id, the `p12` op, the test host's egress log, the Activity routes, the slot's origin
 * and Sam's page.
 */
export function p12Slot(c1: () => string, op: P12Op, egress: () => Array<{ host: string; text: string }>, activity: Activity, origin: string, page: P12Page): P12Slot {
  let state: P12State = EMPTY;
  let before: { journal: Set<string>; jobs: Set<string> } = { journal: new Set(), jobs: new Set() };
  const views: Awaited<ReturnType<P12SlotWorld["reloads"]>> = [];
  const origins: string[] = [];
  let opened: { path: string; width: "desktop" | "phone" } | null = null;
  let settingsRead: { drawn: boolean; panes: string[]; heading: string } | null = null;
  const chatOf = (chat: ChatLabel = "c1") => {
    if (chat !== "c1") throw new Error(`SLOT_P12_UNREAD: chat ${chat} is not opened on a slot`);
    return c1();
  };
  const refresh = async () => {
    state = (await op("read")) ?? EMPTY;
  };

  const readers: P12Readers = {
    cardWords: (chat) => {
      chatOf(chat);
      return state.cards;
    },
    grantRows: () => state.grants,
    // The slot's one fixture effect is `share_post`, kept in the test host's egress log; it has no purchase tool.
    ranEffects: () => egress().map(({ host, text }) => ({ tool: "share_post", args: { host, text } })),
    ledgerJournal: async () => state.journal.filter((r) => !before.journal.has(r.id)),
    jobTitles: () => state.jobs.filter((j) => !before.jobs.has(j.id)).map((j) => j.title),
    async steps(chat = "c1") {
      chatOf(chat);
      const out: StepRow[] = [];
      for (const t of (await activity.activity()).tasks.filter((x) => x.chat === "c1")) {
        for (const s of (await activity.task("c1", t.id)).steps.filter((x) => x.kind !== "summary")) out.push({ task: t.id, tool: s.tool, title: s.title, state: s.state, code: s.code });
      }
      return out;
    },
    looked: null,
    postedGrant: null,
    approvalsTab: unread("approvalsTab"),
    decisions: unread("decisions"),
    commits: unread("commits"),
    proposals: unread("proposals"),
    jobCalls: unread("jobCalls"),
    storesText: unread("storesText"),
    handoffs: unread("handoffs"),
    reloads: async () => [...views],
    settingsAtPhone: async () => settingsRead ?? unread("settingsAtPhone: no settings page was opened and reloaded at phone width")(),
    origins: () => [...origins],
    origin,
  };

  return {
    readers,
    refresh,
    async begin(taskId, send) {
      await op("reset");
      await refresh();
      before = { journal: new Set(state.journal.map((r) => r.id)), jobs: new Set(state.jobs.map((j) => j.id)) };
      if (taskId === "T-P12-13") for (const text of BEFORE_T13) await send(text);
      await refresh();
    },
    async event(name, payload) {
      if (name === "open") {
        opened = { path: payload.path ?? "/settings", width: payload.width === "desktop" ? "desktop" : "phone" };
        origins.push(...(await page.settings(opened.path, opened.width)).origins);
      } else if (name === "reload" && opened) {
        const r = await page.settings(opened.path, opened.width);
        origins.push(...r.origins);
        if (opened.width === "phone") settingsRead = { drawn: r.drawn, panes: r.panes, heading: r.heading };
      } else if (name === "reload") {
        const width = payload.width === "phone" ? "phone" : "desktop";
        const r = await page.reload(c1(), width);
        views.push({ width, when: "before", ...r.before }, { width, when: "after", ...r.after });
        origins.push(...r.origins);
      } else return false;
      await refresh();
      return true;
    },
  };
}
