// The tier-1 harness of the P3 tasks (F33): P5's world (`P5Tier1World`: Sam's real `ChatEngine` chats `c1` and `c2`,
// the real sub-agent host, facets and verifier, the real browse namespace over the fake browser, the real Ledger, jobs,
// routes and panel script, and the one scripted fake model) with the P3 probe pages served for `example.com` and held in
// each child's url table beside `example.invalid`, the tools a task plants for a child's gate to refuse, and Pat's main
// chat. Turns, beside P5's `prompt`, `children`, `hold`, `decide`, `tick` and `open`:
//   - `midchild` (payload `chat`, `text`, `stop`): the launched sub-agents run, the first held mid-run at the fake's
//     `hold: "child"` step (fletch's child that "needs two alarms"); while it is held Sam sends `text` and its turn runs
//     to its end, or presses the Stop of the chat's oldest running task (the drawer's, the turn having ended), and the
//     world keeps `held`; then
//     the step is released and every sub-agent and the handoff turns they wake run to their end;
//   - `retry` (payload `chat`): the host delivers the chat's first delegation's handoff again, as a retry would;
//   - `pat` (payload `text`): Pat's message to his main chat, run with its sub-agents to the end;
//   - `reload` (payload `chat`): the chat's object is evicted and read again from its storage.
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import type { El } from "../../workers/support/page-harness.ts";
import { page } from "../../workers/support/page-harness.ts";
import type { FakeRequest } from "../../support/fake-model.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { CHILD_MARK, JOB_TASK_MARK, P5Tier1World, type P5HarnessOptions, pat, sam } from "../p5-activity/harness.ts";
import type { ChatLabel, ChildRow, DrawnSection, MailView, P3World, ThreadDom } from "./world.ts";
import { DEAD, PROBE, PROBE_2, PROBE_TITLE } from "./world.ts";

export { pat, sam };
/** The probe page: a title, two sentences and three links. */
export const PAGE = `# ${PROBE_TITLE}\n\nThis page is for the p3 probe. It has three links.\n\n[One](https://example.com/p3-one) [Two](https://example.com/p3-two) [Three](https://example.com/p3-three)`;

export interface P3HarnessOptions extends Pick<P5HarnessOptions, "script" | "seed" | "world" | "sites" | "fill"> {
  /** Offer the child the planted write, send, reaction and memory tools (T-P3-03). */
  planted?: boolean;
}

const settleUi = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const byClass = (e: El, cls: string) => all(e).filter((c) => c.className.split(" ").includes(cls));
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const messagesOf = (r: FakeRequest) => ((r.inputs as { messages?: Array<{ role: string; content?: unknown }> }).messages ?? []);

export class P3Tier1World extends P5Tier1World implements P3World {
  readonly probeTitle = PROBE_TITLE;
  retried: P3World["retried"] = null;
  reloaded: P3World["reloaded"] = null;
  held: P3World["held"] = null;
  private readonly recorded: string[] = [];
  patChat = "";
  /** Rewrites the shipped page script before `threadDom` runs it: a planted test's renderer fault (T-P3-05). */
  plantPage: (js: string) => string = (js) => js;

  constructor(o: P3HarnessOptions) {
    const recorded: string[] = [];
    super({ ...o, page: PAGE, childUrls: [PROBE, PROBE_2, DEAD], jobUrls: [PROBE], ...(o.planted ? { childTools: () => [plantedTools(recorded)] } : {}) });
    this.recorded = recorded;
  }

  async open(): Promise<void> {
    await super.open();
    this.patChat = ((await this.w.host(pat.email).chats.main(this.w.clock.now)) as { chatId: string }).chatId;
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event") return super.play(turn);
    const p = (turn.payload ?? {}) as { text?: string; chat?: ChatLabel; stop?: "yes" };
    const chat = p.chat ?? "c1";
    if (turn.name === "midchild") {
      const running = this.w.subagents.get(this.chatId(chat))?.settle();
      await this.w.fake.reached("child", ++this.holds);
      if (p.text) {
        this.w.clock.now += 60_000;
        await this.w.say(sam.email, p.text, this.chatId(chat));
        await this.engine(chat).settled();
      }
      if (p.stop) {
        // The task whose child is held: the chat's oldest still running.
        const t = (await this.activity()).tasks.filter((x) => x.chat === chat && x.status === "running").at(-1);
        await this.w.http(sam.email, "POST", `/app/activity/${this.chatId(chat)}/${t?.id}/stop`);
      }
      this.held = { replies: this.replies(chat), children: this.children(chat) };
      this.w.fake.release("child");
      await running;
      await this.settle(chat);
    } else if (turn.name === "retry") {
      const first = this.children(chat)[0] as ChildRow;
      const before = this.mailbox(chat).find((m) => m.messageId === `handoff:${first.grp}`);
      const r = await this.engine(chat).handoff({ grp: first.grp, person: sam.email, text: "Your sub-agents have returned (again)." });
      this.retried = { status: r.status, ...("ordinal" in r ? { ordinal: r.ordinal as number } : {}), ...(before ? { firstOrdinal: before.ordinal } : {}) };
      await this.engine(chat).settled();
    } else if (turn.name === "pat") {
      await this.w.say(pat.email, p.text as string, this.patChat);
      const e = this.w.chats.harness(this.patChat).instance;
      await e.settled();
      await this.w.subagents.get(this.patChat)?.settle();
      await e.settled();
    } else if (turn.name === "reload") {
      this.reloaded = { entries: this.entryIds(chat), statuses: this.children(chat).map((c) => `${c.id}:${c.status}:${c.code ?? ""}`) };
      this.w.chats.harness(this.chatId(chat)).evict();
    } else return super.play(turn);
  }

  private rowsOf(chatId: string): ChildRow[] {
    void this.w.chats.harness(chatId).instance; // after a reload the object is built again before its rows are read
    const s = this.w.subagents.get(chatId);
    if (!s) return [];
    return s.store.list().map((r) => ({ id: r.id, grp: r.grp, turnId: r.turnId, parent: r.parent, role: r.role, depth: r.depth, brief: r.brief, status: r.status, code: r.code ?? null, tokens: r.tokens, verdict: r.verdict, verdictReason: r.verdictReason, refusals: r.refusals, handedOffAt: s.store.handedOffAt(r.grp) }));
  }

  children(chat: ChatLabel = "c1"): ChildRow[] {
    return this.rowsOf(this.chatId(chat));
  }

  patChildren(): ChildRow[] {
    return this.rowsOf(this.patChat);
  }

  mailbox(chat: ChatLabel = "c1"): MailView[] {
    return this.w.chats
      .harness(this.chatId(chat))
      .rows("SELECT ordinal, message_id, kind, scope, state, turn_id FROM mailbox ORDER BY ordinal")
      .map((r) => ({ ordinal: Number(r.ordinal), messageId: String(r.message_id), kind: String(r.kind), scope: String(r.scope), state: String(r.state), turnId: r.turn_id === null ? null : String(r.turn_id) }));
  }

  async childMessages(id: string, chat: ChatLabel = "c1") {
    const s = this.w.subagents.get(this.chatId(chat));
    const messages = s ? await s.record.transcript(id) : [];
    return messages.map((m) => ({ role: m.role, text: m.role === "assistant" ? (m.content as Array<{ type: string; text?: string; name?: string; arguments?: unknown }>).map((c) => (c.type === "toolCall" ? `${c.name}(${JSON.stringify(c.arguments)})` : (c.text ?? ""))).join("") : textOf((m as { content?: unknown }).content) }));
  }

  requests(): string[] {
    return this.chatRequests().map((r) => messagesOf(r).filter((m) => m.role !== "system").map((m) => textOf(m.content)).join("\n"));
  }

  childRequests() {
    return this.w.fake.requests
      .filter((r) => JSON.stringify(messagesOf(r)).includes(CHILD_MARK))
      .map((r) => ({ system: textOf(messagesOf(r).find((m) => m.role === "system")?.content), messages: messagesOf(r).filter((m) => m.role !== "system").map((m) => ({ role: m.role, text: textOf(m.content) + ((m as { tool_calls?: unknown }).tool_calls ? JSON.stringify((m as { tool_calls?: unknown }).tool_calls) : "") })) }));
  }

  instructions(): string[] {
    return WORK_WORDS.split("\n").filter((l) => l.trim());
  }

  async threadDom(chat: ChatLabel = "c1", phone = false): Promise<ThreadDom> {
    const p = await page({ onSend() {} }, phone ? {} : { desktop: true }, this.plantPage);
    const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
    p.open(s);
    p.deliver(s, { type: "history", ...this.engine(chat).history() });
    const nodes = p.log.children.flatMap((c) => [c, ...all(c)]);
    return {
      bubbles: p.log.children.filter((c) => /\b(you|agent)\b/.test(c.className)).map((c) => ({ side: /\byou\b/.test(c.className) ? ("you" as const) : ("agent" as const), text: c.text() })),
      lists: nodes.filter((n) => n.tag === "ol" || n.tag === "ul").map((n) => ({ tag: n.tag, start: n.attrs.start ?? null, items: n.children.map((c) => c.text()) })),
      kinds: p.log.children.map((c) => c.className.split(" ").filter((x) => x !== "m").join(" ")),
    };
  }

  async sections(chat: ChatLabel, id: string, phone = false): Promise<DrawnSection[]> {
    const at = (await this.activity()).tasks.findIndex((t) => t.chat === chat && t.id === id);
    const p = await this.page(phone ? {} : { desktop: true });
    const row = this.rowsIn(p).filter((r) => !r.dataset.run)[at];
    if (!row) return [];
    await row.onclick?.();
    await settleUi();
    const out: DrawnSection[] = [];
    for (const n of p.byId("task-steps").children) {
      if (n.className.split(" ").includes("qf-items-head")) out.push({ n: n.dataset.section ?? "", head: n.children.map((c) => c.textContent).join(" | "), rows: [] });
      else if (n.className === "task-sub") out.at(-1)?.rows.push({ id: n.dataset.row ?? "", depth: Number(n.dataset.depth), line: n.text(), steps: [] });
      else if (n.tag === "ol" && n.className.includes("qf-tl--nested")) out.at(-1)?.rows.at(-1)?.steps.push(...all(n).filter((e) => e.tag === "li").map((li) => byClass(li, "nm")[0]?.textContent ?? ""));
    }
    return out;
  }

  async ledgerCalls() {
    const rows = [...(await this.w.ledger().modelCalls({ person: sam.email })), ...(await this.w.ledger().modelCalls({ person: pat.email }))];
    return rows.map((r) => ({ runId: r.runId, route: String(r.route), person: r.person }));
  }

  effects(): string[] {
    return [...this.recorded];
  }

  entryIds(chat: ChatLabel = "c1"): string[] {
    return this.engine(chat)
      .history()
      .entries.map((e) => `${e.kind}:${(e as { mid?: string; turn?: string }).mid ?? (e as { turn?: string }).turn ?? ""}`);
  }

  chunkLines(): string[] {
    const h = [...this.w.objects()].find(([n]) => n === `person:${sam.email}`)?.[1];
    return h ? h.rows("SELECT text FROM chunks").map((r) => String(r.text)) : [];
  }

  jobResults(): string[] {
    return this.w.fake.requests
      .filter((r) => JSON.stringify(messagesOf(r)).includes(JOB_TASK_MARK))
      .flatMap((r) => messagesOf(r).filter((m) => m.role === "tool").map((m) => textOf(m.content)));
  }

  async snapshot(): Promise<Snapshot> {
    return { journal: (await this.journal()).map((r) => `${r.kind}:${r.outcome}`), vault: [], r2: await this.files() };
  }
}

/**
 * The tools a task plants beside a child's read (T-P3-03): a write, a send, a reaction and a memory save, each of the
 * kind its real one is, each recording what it did had it run. The child's gate (`subAgentGate`) refuses all four on
 * the production path, so a run where any records is a child that acted.
 */
function plantedTools(recorded: string[]): Namespace {
  const tool = (name: string, kind: "action" | "observation", mutates: boolean) => ({
    name,
    kind,
    ...(mutates ? { mutates: true } : {}),
    label: name.replaceAll("_", " "),
    description: `planted ${name}`,
    parameters: { type: "object", properties: {} } as never,
    execute: async () => {
      recorded.push(name);
      return { content: [{ type: "text" as const, text: `${name} ran` }], details: {} };
    },
  });
  return { name: "planted", description: "the tools a child must never run", deferral: "eager", tools: [tool("file_write", "action", true), tool("send_to_user", "action", false), tool("react", "action", false), tool("memory_write", "observation", true)] } as Namespace;
}

export function p3Harness(o: P3HarnessOptions): TaskHarness<P3World> {
  return {
    setup: async () => {
      const w = new P3Tier1World(o);
      await w.open();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P3Tier1World).play(turn),
  };
}

/** The task's turns played through `p3Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P3World>, o: P3HarnessOptions, turns = task.turns): Promise<P3Tier1World> {
  const h = p3Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P3Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Each grader of the task over `played`'s world: true when it holds (a minefield when it does not fire). */
export async function graded(task: DefinedTask<P3World>, o: P3HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
