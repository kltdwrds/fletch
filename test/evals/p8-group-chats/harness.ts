// The tier-1 harness of the P8 tasks of today (F60): P14's world (`P14Tier1World`: P9's over P3's authority world, Sam
// Solo's chats `c1` and `c2`, Pat Solo's colleague request, Sam's real mail store and the registry with every
// namespace) with what the room refusals name (D-0025 door 1):
//   - the registry's room guard (`roomReach`) and the planted room specs, each registered in a real `ToolRegistry`;
//   - `POST /app/chats` as Sam through the app's real route, with a room body and with an ordinary title, the chats of
//     Sam's `Person` counted before and after;
//   - every model request labelled by the turn that made it (`c1` is the main chat, `c2` the side chat, the colleague's
//     request its own chat, an inbound mail the mail chat it lands in);
//   - `requestText` for a request Sam's agent relays to Pat, and `plan()` over the hosts as shipped.
// Turns, beside P14's, P9's and P3's:
//   - `inbound` (payload `text`, `from`, `ask`): a mail from Pat Solo's envelope address to Sam's platform mailbox, its
//     `From:` header the payload's (a claim to be Sam), then Sam's next message in the chat it landed in, the turn;
//   - `room-post` / `ordinary-post`: `POST /app/chats` with a room body naming Pat, and with a title;
//   - `page` (payload `width`): the page as served to Sam and the kinds the chat list holds.

import { requestText } from "../../../packages/agent/src/chat/inputs.ts";
import { PUBLIC_HOSTS, plan } from "../../../packages/agent/src/egress/policy.ts";
import type { ParsedMail } from "../../../packages/agent/src/mail/mime.ts";
import { roomReach, ToolRegistry, type ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { P14Tier1World, pat, plantedSpec, sam } from "../p14-identity/harness.ts";
import { MAIL_ASK } from "./runs.ts";
import type { Opened, P8World, Page, Planted, Prompt } from "./world.ts";
import { ROOM_PLANTED, VOICE_PLANTED } from "./world.ts";

export { pat, plantedSpec, sam };

type Msg = { role: string; content?: unknown };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** The description each planted spec carries: what a room tool would offer. */
export const PLANTED_DESCRIPTIONS: Record<string, string> = {
  group_create: "Creates a group chat with other people.",
  chat_add_person: "Adds a person to this chat.",
  group_messages_read: "Reads the messages of a connected group.",
  send_as_owner: "Sends a message from the person's own account.",
};
/** What a `ToolRegistry` answers when `spec` is registered in `namespace`: null, or the refusal's message. */
export const registeredIn = (namespace: string, spec: ToolSpec): string | null => {
  try {
    new ToolRegistry([{ name: namespace, description: `${namespace} tools`, deferral: "eager", tools: [spec] }]);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
};
const plantedIn = (name: string) => (name === "group_messages_read" ? "connector_planted" : "chat");

export interface P8HarnessOptions {
  script: FakeStep[];
}

export class P8Tier1World extends P14Tier1World implements P8World {
  roomPost: Opened | null = null;
  ordinaryPost: Opened | null = null;
  readonly pages: Page[] = [];
  readonly relayed = requestText({ person: pat.email, requestId: "p8-relay", from: sam.email, viaAgent: true, origin: sam.email, hops: 0, text: "p8 probe: could we move our meeting to Thursday?" }, pat.name, (e) => (e === sam.email ? sam.name : e === pat.email ? pat.name : e));
  private readonly labels: Prompt["surface"][] = [];
  private inbound = 0;

  async play(turn: Turn): Promise<void> {
    const start = this.w.fake.requests.length;
    const surface: Prompt["surface"] = turn.kind === "prompt" ? (turn.chat === "c2" ? "side" : "main") : turn.kind === "event" && turn.name === "request" ? "request" : turn.kind === "event" && turn.name === "inbound" ? "mail" : "other";
    const p = (turn.kind === "event" ? turn.payload ?? {} : {}) as Record<string, string>;
    if (turn.kind === "event" && turn.name === "inbound") {
      const r = await this.mailH.instance.receive({ kind: "person", from: pat.email, digest: `p8-mail-${++this.inbound}`, message: { from: p.from ?? `${pat.name} <${pat.email}>`, subject: "p8 probe", text: p.text ?? "" } as ParsedMail });
      if (!r.ok) throw new Error(`P8_MAIL_REFUSED: ${r.code}`);
      // A mail notice wakes no turn (only a job's does, F24): Sam's next message in the chat it landed in is the turn.
      await super.play({ kind: "prompt", by: sam.email, text: p.ask ?? MAIL_ASK });
    } else if (turn.kind === "event" && (turn.name === "room-post" || turn.name === "ordinary-post")) {
      const body = turn.name === "room-post" ? { kind: "room", people: [pat.email], title: "p8 probe room" } : { title: "p8 probe side chat" };
      const before = this.w.chatsOf(sam.email).length;
      const r = await this.w.http(sam.email, "POST", "/app/chats", body);
      const opened = { status: r.status, code: typeof r.body.code === "string" ? r.body.code : null, reason: String(r.body.reason ?? ""), before, after: this.w.chatsOf(sam.email).length };
      if (turn.name === "room-post") this.roomPost = opened;
      else this.ordinaryPost = opened;
    } else if (turn.kind === "event" && turn.name === "page") {
      const html = String((await this.w.http(sam.email, "GET", `/chats/${this.chatId("c1")}`)).body.html ?? "");
      const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
      const attr = (a: string) => /\b(?:aria-label|title|placeholder|value)="([^"]*)"/.exec(a)?.[1] ?? "";
      const id = (a: string) => /\bid="([^"]*)"/.exec(a)?.[1] ?? "";
      const controls = [
        ...[...markup.matchAll(/<(button|a|select)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => `${m[1]}#${id(m[2] ?? "")}: ${strip(m[3] ?? "")} ${attr(m[2] ?? "")}`.trim()),
        ...[...markup.matchAll(/<input\b([^>]*)>/g)].map((m) => `input#${id(m[1] ?? "")}: ${attr(m[1] ?? "")}`.trim()),
      ];
      const list = (await this.w.http(sam.email, "GET", "/app/chats")).body as { chats?: Array<{ kind?: string }> };
      this.pages.push({ width: (p.width as Page["width"]) ?? "desktop", controls, kinds: [...new Set((list.chats ?? []).map((c) => String(c.kind)))].sort() });
    } else await super.play(turn);
    for (let i = start; i < this.w.fake.requests.length; i++) this.labels[i] = surface;
  }

  roomGuard(t: { name: string; description: string }): string | null {
    return roomReach(t);
  }

  roomPlanted(): Planted[] {
    return [...ROOM_PLANTED, ...VOICE_PLANTED].map((name) => ({ name, refused: registeredIn(plantedIn(name), plantedSpec(name, PLANTED_DESCRIPTIONS[name])) }));
  }

  prompts(): Prompt[] {
    return this.w.fake.requests.map((r, i) => {
      const messages = (r.inputs as { messages?: Msg[] }).messages ?? [];
      // The system block is the assembled prefix and the runtime envelope (each opens with a `# ` heading); a mail or
      // job notice is a system-role line of the transcript, and stays with the rest of the conversation.
      const block = (m: Msg) => m.role === "system" && textOf(m.content).startsWith("# ");
      return { surface: this.labels[i] ?? "other", system: messages.filter(block).map((m) => textOf(m.content)).join("\n"), text: messages.filter((m) => !block(m)).map((m) => textOf(m.content)).join("\n") };
    });
  }

  calls(): string[] {
    const out: string[] = [];
    for (const r of this.w.fake.requests) {
      for (const m of (r.inputs as { messages?: Msg[] }).messages ?? []) {
        if (m.role === "assistant" && Array.isArray(m.content)) for (const c of m.content as Array<{ type?: string; name?: string }>) if (c.type === "toolCall" && c.name) out.push(c.name);
      }
    }
    return out;
  }

  egress(url: string, method: string, plantHost?: string): string {
    const hosts = plantHost ? [...PUBLIC_HOSTS, { host: plantHost, methods: ["GET", "POST"], credentials: [] }] : PUBLIC_HOSTS;
    const r = plan({ url, method, body: "p8 probe" }, hosts);
    return r.ok ? "ok" : r.code;
  }
}

export function p8Harness(o: P8HarnessOptions): TaskHarness<P8World> {
  return {
    setup: async () => {
      const w = new P8Tier1World({ script: o.script });
      await w.open();
      await w.w.host(sam.email).memory.standingFiles();
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P8Tier1World).play(turn),
  };
}
