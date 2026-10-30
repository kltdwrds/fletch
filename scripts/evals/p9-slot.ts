// The P9 readers and events over a preview slot (F37): a credentials task's world on a real slot with the real model,
// beside P5's (`p5-slot.ts`: the thread, the replies, the system prompts, the instruction lines), apart from the slot
// client so a hermetic test reads them without its socket, passkey or browser. Sam's chat `c1` is the trial's; her
// credential rows, every request the Vault's network was sent, the chat's cards, stored messages and model requests, her
// files and every object's rows are the test host's `p9` op (`scripts/preview-slot/test-host-p9.mjs`); the bubbles two
// tabs draw, the chat reloaded at two widths and the settings page are Sam's page in a real browser
// (`scripts/evals/p9-page.ts`).
//
// Each trial begins with Sam's credential rows deleted (`begin`), so T-P9-13 starts with no credential; T-P9-15 and
// T-P9-16 then have her Example API key captured through the capture form as she captures one; T-P9-17 is played after
// T-P9-13's ask and T-P9-14's typed key in its own chat, the setup's link submitted on the form. The events:
//   - `tabs` (payload `text`): two tabs open on `c1`; Sam types `text` in the first and sends it; once the turn's task
//     settled, each tab's bubbles are read, then the sending tab reloaded and the chat opened at phone width;
//   - `reload` (payload `width`): the chat drawn at that width, then reloaded and drawn again; after an `open`, the opened
//     page reloaded instead;
//   - `open` (payload `path`, `width`): that settings page opened at that width.
//
// What the slot cannot see is said, never guessed: a reader no tier-2 grader uses (P3's, F36's surfaces, the devices,
// the tools offered, the sign-in page, the capture form's submit) throws `SLOT_P9_UNREAD`, and so does a read of a chat
// other than `c1`.
import type { P3World } from "../../test/evals/p3-delegation/world.ts";
import setup from "../../test/evals/p9-connectors/setup-real-model.task.ts";
import typed from "../../test/evals/p9-connectors/typed-secret-real-model.task.ts";
import type { AuditView, CallView, CardView, ChatLabel, GrantView, HostView, P9SlotWorld, SecretView, SentView, Tabs } from "../../test/evals/p9-connectors/world.ts";
import { API_HOST, API_REF } from "../../test/evals/p9-connectors/world.ts";
import { TurnError } from "../../test/support/evals.ts";

/** What the test host's `p9` op answers for a chat. */
export interface P9State {
  vault: { secrets: SecretView[]; grants: GrantView[]; hosts: HostView[]; audit: AuditView[]; events: Array<{ ref: string; event: string; by: string }>; sent: SentView[] };
  chat: { cards: CardView[]; messages: string[]; requests: string[] };
  files: string[];
  rowsText: string;
}

/** What one width of the chat draws: its first capture item's text, the bubble of Sam's typed key, and the Connected list. */
export interface P9View {
  capture: string | null;
  masked: string | null;
  connected: string[];
}

/** Sam's page on the slot, in a real browser. */
export interface P9Page {
  /** Two tabs on the chat: `text` sent from the first; `settled` resolves once the turn's task has; then both read, the first reloaded, the chat opened at phone width. */
  tabs(chatId: string, text: string, settled: () => Promise<void>): Promise<Tabs>;
  /** The chat drawn at `width`, then reloaded and drawn again, with the origin of every request the page made. */
  reload(chatId: string, width: "desktop" | "phone"): Promise<{ before: P9View; after: P9View; origins: string[] }>;
  /** `path` loaded at `width`: whether the settings pane drew and its heading, with every request's origin. */
  settings(path: string, width: "desktop" | "phone"): Promise<{ drawn: boolean; heading: string; origins: string[] }>;
}

/** The P9 world's readers a slot answers: P9's own, F36's and the slot's, over P5's for the thread, prompts and lines. */
export type P9Readers = Omit<P9SlotWorld, keyof P3World | "marks" | "tabs" | "submitted"> & Pick<P3World, "results" | "files" | "memoryLines">;

export interface P9Slot {
  readers: P9Readers;
  /** The bubbles two tabs drew of Sam's typed send; null before a `tabs` event. */
  readonly tabs: Tabs | null;
  /** How many requests the Vault's network had been sent when each event ran. */
  readonly marks: Record<string, number>;
  /** The capture form's submit is not played on a slot. */
  readonly submitted: null;
  /** Reads `c1`'s rows again. */
  refresh(): Promise<void>;
  /** A trial's start: Sam's credential rows deleted, then the task's setup (T-P9-15, 16: her key; T-P9-17: T-P9-13 and 14 played, the link submitted). */
  begin(taskId: string, send: (text: string) => Promise<unknown>): Promise<void>;
  /** A P9 event (`tabs`, `reload`, `open`); `settled` waits out the turn a `tabs` send started. False for an event it does not play. */
  event(name: string, payload: Record<string, string>, settled: () => Promise<void>): Promise<boolean>;
}

/** The `p9` op: `reset` deletes Sam's credential rows; `read` answers the chat's state. */
export type P9Op = (call: "reset" | "read") => Promise<P9State | null>;
/** A form posted to the slot's capture route as Sam, from the page's own origin: its status. */
export type CaptureForm = (form: Record<string, string>) => Promise<number>;

const EMPTY: P9State = { vault: { secrets: [], grants: [], hosts: [], audit: [], events: [], sent: [] }, chat: { cards: [], messages: [], requests: [] }, files: [], rowsText: "" };

const unread = (name: string) => () => {
  throw new Error(`SLOT_P9_UNREAD: ${name} is not read on a slot`);
};

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean };

/** Sam's Example API key as the capture form takes it: bound to api.example.com, sent as a Bearer header, standing. */
export const exampleKeyForm = (value: string): Record<string, string> => ({ ref: API_REF, host: API_HOST, kind: "secret", header: "authorization", prefix: "Bearer ", methods: "GET,POST", permission: "standing", label: "Example API", value });

/** The capture form's fields for a capture link's query, as the page fills them; the value is the person's. */
export function formOfLink(link: string, value: string): Record<string, string> {
  const q = new URLSearchParams(link.slice(link.indexOf("?") + 1).replace(/[.)]+$/, ""));
  return { ref: q.get("ref") ?? "", host: q.get("host") ?? "", kind: q.get("kind") ?? "secret", header: q.get("header") ?? "authorization", prefix: q.get("prefix") ?? "Bearer ", methods: "GET", permission: "standing", label: "Example API", value, ...(q.get("fills") ? { fills: "on" } : {}), ...(q.get("setup") ? { setup: q.get("setup") as string } : {}) };
}

/**
 * The P9 readers over chat `c1`'s id, the `p9` op, the capture route, the system prompts P5 read, the slot's origin and
 * Sam's page. `value()` makes the value Sam enters on the form, which no model ever sees.
 */
export function p9Slot(c1: () => string, op: P9Op, capture: CaptureForm, prompts: () => string[], origin: string, page: P9Page, value: () => string): P9Slot {
  let state: P9State = EMPTY;
  let tabs: Tabs | null = null;
  const marks: Record<string, number> = {};
  const views: Awaited<ReturnType<P9SlotWorld["reloads"]>> = [];
  const origins: string[] = [];
  let opened: { path: string; width: "desktop" | "phone" } | null = null;
  let settingsRead: { drawn: boolean; heading: string } | null = null;
  const chatOf = (chat: ChatLabel = "c1") => {
    if (chat !== "c1") throw new Error(`SLOT_P9_UNREAD: chat ${chat} is not opened on a slot`);
    return c1();
  };
  const messages = () => state.chat.messages.map((b) => JSON.parse(b) as Msg);
  const results = (chat: ChatLabel = "c1") => {
    chatOf(chat);
    return messages()
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ tool: m.toolName ?? "", text: textOf(m.content), isError: !!m.isError }));
  };
  const refresh = async () => {
    state = (await op("read")) ?? EMPTY;
  };

  const readers: P9Readers = {
    secrets: () => state.vault.secrets,
    hostRows: () => state.vault.hosts,
    auditRows: () => state.vault.audit,
    vaultEvents: () => state.vault.events,
    credentialGrants: () => state.vault.grants,
    sent: () => [...state.vault.sent],
    cards: (chat) => {
      chatOf(chat);
      return state.chat.cards;
    },
    calls: (chat) => {
      chatOf(chat);
      return messages()
        .filter((m) => m.role === "assistant" && Array.isArray(m.content))
        .flatMap((m) => (m.content as Array<{ type: string; name?: string; arguments?: Record<string, unknown> }>).filter((c) => c.type === "toolCall").map((c): CallView => ({ tool: String(c.name), args: c.arguments ?? {} })));
    },
    results,
    files: async () => [...state.files],
    // A memory line is a `memory_write` that went through, as the tier-1 worlds read it.
    memoryLines: () => results().filter((r) => r.tool === "memory_write" && !r.isError).map((r) => r.text),
    rowsText: () => state.rowsText,
    // What every chat model request carried: its system prompt (P5's read) and its other messages (the op's).
    sawText: () => JSON.stringify([...prompts(), ...state.chat.requests]),
    connected: unread("connected"),
    devices: unread("devices"),
    offered: unread("offered"),
    typed: unread("typed"),
    captureItem: unread("captureItem"),
    captureLink: unread("captureLink"),
    connectedRows: unread("connectedRows"),
    disconnect: unread("disconnect"),
    authorityGrants: unread("authorityGrants"),
    permissions: unread("permissions"),
    reloads: async () => [...views],
    settingsAtPhone: async () => settingsRead ?? unread("settingsAtPhone: no settings page was opened and reloaded")(),
    origins: () => [...origins],
    origin,
  };

  return {
    readers,
    get tabs() {
      return tabs;
    },
    marks,
    submitted: null,
    refresh,
    async begin(taskId, send) {
      await op("reset");
      if (taskId === "T-P9-15" || taskId === "T-P9-16") {
        const status = await capture(exampleKeyForm(value()));
        if (status !== 201) throw new Error(`P9_KEY_NOT_CAPTURED: the capture form answered ${status}`);
      }
      if (taskId === "T-P9-17") {
        // T-P9-13's ask, its link submitted on the form as Sam (the Connected row), then T-P9-14's typed key.
        await send(setup.turns[0]?.kind === "event" ? String(setup.turns[0].payload?.text) : "");
        await refresh();
        const link = results().map((r) => /\/vault\/capture\?\S+/.exec(r.text)?.[0]).find(Boolean);
        // The ask's link is the agent's to make: a trial without one is its failure, not the slot's.
        if (!link) throw new TurnError("P9_NO_LINK", "T-P9-13's ask returned no capture link");
        const status = await capture(formOfLink(link, value()));
        if (status !== 201) throw new Error(`P9_LINK_NOT_SUBMITTED: the capture form answered ${status}`);
        await send(typed.turns[0]?.kind === "event" ? String(typed.turns[0].payload?.text) : "");
      }
      await refresh();
    },
    async event(name, payload, settled) {
      marks[name] = state.vault.sent.length;
      if (name === "tabs") tabs = await page.tabs(c1(), payload.text ?? "", settled);
      else if (name === "open") {
        opened = { path: payload.path ?? "/settings/connectors", width: payload.width === "desktop" ? "desktop" : "phone" };
        const r = await page.settings(opened.path, opened.width);
        origins.push(...r.origins);
      } else if (name === "reload" && opened) {
        const r = await page.settings(opened.path, opened.width);
        origins.push(...r.origins);
        if (opened.width === "phone") settingsRead = { drawn: r.drawn, heading: r.heading };
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
