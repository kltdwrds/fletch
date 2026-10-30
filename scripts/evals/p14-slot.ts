// The P14 readers and events over a preview slot (F41): an identity task's world on a real slot with the real model,
// apart from the slot client so a hermetic test reads them without its socket, passkey or browser. Sam's chat `c1` is
// the trial's; its thread is the history the page draws, read again from a fresh socket after a reload; her standing
// files, memory, the objects' table counts, the Ledger's chat model calls, her mail journal rows and the chat's model
// requests (every system message, and the first one's tool lines with the production guard's answer) are the test
// host's `p14` op (`scripts/preview-slot/test-host-p14.mjs`); the drawn name, the reloads and `/settings` are Sam's
// page in a real browser (`scripts/evals/p14-page.ts`). The writers of the standing files are read from the sources.
//
// Each trial begins with the standing-file reset (each standing file but MEMORY.md written back to the seed where it is
// not it) and the passkey seed (a second, inert passkey when Sam holds one); the memory lines, model calls, mail rows
// and table counts a grader reads are the trial's own, those there before it left out. The events:
//   - `look` (payload `width`): the chat drawn at that width and its name, panel and Identity card read;
//   - `reload` (payload `width`, desktop when none): the chat drawn and reloaded at that width, then its replies read
//     from a fresh history, as the tier-1 world reads them after an eviction;
//   - `settings` (payload `route`, `width`): that route opened, reloaded and read at that width, with the stored mode
//     read before and after.
//
// What the slot cannot see is said, never guessed: a reader no tier-2 grader uses (the rows' text, a needle's holders,
// the profile route, a read as Pat, the schema's columns, the planted specs, the reach into sign-in, offboarding, the
// shell) throws `SLOT_P14_UNREAD`, and so does a read of a chat other than `c1`.
import { sources, standingCallersIn } from "../../test/evals/p14-identity/sources.ts";
import type { ChatLabel, Drawn, MailCall, P14SlotWorld, Sent, Standing, ToolLine } from "../../test/evals/p14-identity/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";

/** What the test host's `p14` op answers for a chat. */
export interface P14State {
  standing: Standing[];
  /** The seed's standing files (`defaultStanding`), read on the slot so this file imports no Worker code. */
  seeded: Record<string, string>;
  daily: string[];
  memory: string;
  memoryWriter: string;
  counts: Record<string, Record<string, number>>;
  calls: Array<{ id: number; model: string }>;
  mail: Array<{ id: string; outcome: string; counterpart: string }>;
  systems: string[];
  tools: Array<ToolLine & { guard: string | null }>;
}

/** Sam's page on the slot, in a real browser; each answer carries the origin of every request the page made. */
export interface P14Page {
  /** The chat drawn at `width`: its header name, the panel's, the Identity card's words and controls, the handle line. */
  look(chatId: string, width: "desktop" | "phone"): Promise<{ drawn: Omit<Drawn, "width">; origins: string[] }>;
  /** The chat drawn at `width`, then reloaded and drawn again. */
  reload(chatId: string, width: "desktop" | "phone"): Promise<{ origins: string[] }>;
  /** `route` loaded at `width` and reloaded: whether Settings drew both times, its heading, the stored mode before and after. */
  settings(route: string, width: "desktop" | "phone"): Promise<{ drawn: boolean; heading: string; mode: { before: string | null; after: string | null }; origins: string[] }>;
}

/** The `p14` op: `reset` the standing files, `seed` the second passkey, `read` the chat's state. */
export type P14Op = (call: "reset" | "seed" | "read") => Promise<P14State | null>;

/** The P14 slot world's readers (the scenario world's own aside). */
export type P14Readers = Omit<P14SlotWorld, "snapshot">;

export interface P14Slot {
  readers: P14Readers;
  /** Reads `c1`'s state again. */
  refresh(): Promise<void>;
  /** A trial's start: the standing files reset, the second passkey seeded, what was there before kept aside. */
  begin(): Promise<void>;
  /** A P14 event (`look`, `reload`, `settings`). False for an event it does not play. */
  event(name: string, payload: Record<string, string>): Promise<boolean>;
}

const EMPTY: P14State = { standing: [], seeded: {}, daily: [], memory: "", memoryWriter: "", counts: {}, calls: [], mail: [], systems: [], tools: [] };

const unread = (name: string) => () => {
  throw new Error(`SLOT_P14_UNREAD: ${name} is not read on a slot`);
};
const flat = (counts: P14State["counts"]) => Object.fromEntries(Object.entries(counts).flatMap(([o, ts]) => Object.entries(ts).map(([t, n]) => [`${o}/${t}`, n])));
/** MEMORY.md's lines that are not a heading or blank. */
const curated = (text: string) => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const dailyText = (line: string) => line.replace(/^\S+#\d+ /, "");

/**
 * The P14 readers over chat `c1`'s id, its history as the page draws it, a fresh history read, the `p14` op, Sam's
 * page, the slot's origin and the owner's email.
 */
export function p14Slot(c1: () => string, entries: () => SlotEntry[], fresh: () => Promise<SlotEntry[]>, op: P14Op, page: P14Page, origin: string, owner: string): P14Slot {
  let state: P14State = EMPTY;
  let before = { tables: {} as Record<string, number>, daily: new Set<string>(), memory: new Set<string>(), call: 0, mail: new Set<string>() };
  const drawn: Drawn[] = [];
  const afterReload: Array<{ width: "desktop" | "phone"; replies: string[] }> = [];
  const origins: string[] = [];
  let phone: { drawn: boolean; heading: string } | null = null;
  const mode: { before: string | null; after: string | null } = { before: null, after: null };
  let modeRead = false;
  const callers = standingCallersIn(sources());
  const chatOf = (chat: ChatLabel = "c1") => {
    if (chat !== "c1") throw new Error(`SLOT_P14_UNREAD: chat ${chat} is not opened on a slot`);
    return c1();
  };
  // The thread as Sam sees it: the agent's reasoning is kept in the history but never drawn (P5's reading).
  const thread = (list: SlotEntry[]) => list.flatMap((e) => (e.kind === "thinking" ? [] : [{ kind: e.kind, text: e.text ?? "" }]));
  const refresh = async () => {
    state = (await op("read")) ?? EMPTY;
  };

  const readers = {
    replies: (chat: ChatLabel = "c1") => {
      chatOf(chat);
      return thread(entries())
        .filter((e) => e.kind === "agent")
        .map((e) => e.text);
    },
    thread: (chat: ChatLabel = "c1") => {
      chatOf(chat);
      return thread(entries());
    },
    rowsText: unread("rowsText"),
    tables: () => flat(state.counts),
    get before() {
      return before.tables;
    },
    standing: async () => state.standing,
    get seeded() {
      return state.seeded;
    },
    // The trial's own lines: each daily line and each MEMORY.md line that was not there when it began.
    remembered: async () => [...state.daily.filter((l) => !before.daily.has(l)).map(dailyText), ...curated(state.memory).filter((l) => !before.memory.has(l))],
    memoryWriter: async () => state.memoryWriter,
    holding: unread("holding"),
    drawn,
    profile: null,
    asked: (): Sent[] => state.systems.map((text) => ({ surface: "chat" as const, text })),
    prefix: () => state.systems.at(-1) ?? "",
    modelIds: async () => [...new Set(state.calls.filter((c) => c.id > before.call).map((c) => c.model))],
    readAs: unread("readAs"),
    get profileColumns(): string[] {
      return unread("profileColumns")();
    },
    standingCallers: callers,
    tools: (): ToolLine[] => state.tools.map(({ name, description }) => ({ name, description })),
    // The production guard (`identityReach`), run on the slot by the `p14` op over the same lines.
    guard: (t: ToolLine) => {
      const line = state.tools.find((x) => x.name === t.name && x.description === t.description);
      if (!line) throw new Error(`SLOT_P14_UNREAD: no guard was read for ${t.name}`);
      return line.guard;
    },
    planted: unread("planted"),
    get loginReach(): string[] {
      return unread("loginReach")();
    },
    get offboarded(): never[] {
      return unread("offboarded")();
    },
    // A mail is handed to the host when its journal row is done; a trial's own rows only.
    handed: (): MailCall[] => state.mail.filter((m) => !before.mail.has(m.id) && m.outcome === "DONE").map((m) => ({ fields: [], person: owner, to: m.counterpart, text: "" })),
    get fileColumns(): string[] {
      return unread("fileColumns")();
    },
    get shell(): never {
      return unread("shell")();
    },
    reloads: async () => [...afterReload],
    settingsAtPhone: async () => phone ?? unread("settingsAtPhone: no settings route was opened at phone width")(),
    origins: () => [...origins],
    origin,
    mode,
  } satisfies P14Readers;

  return {
    readers,
    refresh,
    async begin() {
      await op("reset");
      await op("seed");
      await refresh();
      before = {
        tables: flat(state.counts),
        daily: new Set(state.daily),
        memory: new Set(curated(state.memory)),
        call: Math.max(0, ...state.calls.map((c) => c.id)),
        mail: new Set(state.mail.map((m) => m.id)),
      };
    },
    async event(name, payload) {
      const width = payload.width === "phone" ? "phone" : "desktop";
      if (name === "look") {
        const r = await page.look(c1(), width);
        drawn.push({ width, ...r.drawn });
        origins.push(...r.origins);
      } else if (name === "reload") {
        origins.push(...(await page.reload(c1(), width)).origins);
        afterReload.push({ width, replies: thread(await fresh()).filter((e) => e.kind === "agent").map((e) => e.text) });
      } else if (name === "settings") {
        const r = await page.settings(payload.route ?? "/settings/general", width);
        origins.push(...r.origins);
        if (!modeRead) mode.before = r.mode.before;
        modeRead = true;
        mode.after = r.mode.after;
        if (width === "phone") phone = { drawn: r.drawn, heading: r.heading };
      } else return false;
      await refresh();
      return true;
    },
  };
}
