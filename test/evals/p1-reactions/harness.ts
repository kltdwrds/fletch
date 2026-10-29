// The tier-1 harness of the P1 tasks (F20): `P1World` over the F10 harness, the authority world with Sam's real
// `ChatEngine` chats and the scripted fake model. A `prompt` turn is `w.say`; an `event` turn named `reaction` is
// the owner's `react` frame (`ChatEngine.react`), its payload the chat label, the message id and the emoji. Each
// opened chat has one socket from the start, so a task reads the frames in the order Sam's page would.
import { AGENT_REACTOR } from "../../../packages/agent/src/chat/message-actions.ts";
import type { ChatStore } from "../../../packages/agent/src/chat/store.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import type { HarnessSocket } from "../../support/object-harness.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { type AuthorityWorld, authorityWorld, ada as sam, T0, type WorldOptions } from "../../workers/support/authority-world.ts";
import { AGENT, type ChatLabel, type Entry, type Frame, type MailInfo, type ModelRequest, type P1World, type ReactionRow, type TurnInfo } from "./world.ts";

export { sam, T0 };

export class P1Tier1World implements P1World {
  readonly w: AuthorityWorld;
  private readonly ids = new Map<ChatLabel, string>();
  private readonly sockets = new Map<ChatLabel, HarnessSocket>();

  constructor(w: AuthorityWorld) {
    if (AGENT_REACTOR !== AGENT) throw new Error(`P1_REACTOR_DRIFT: the agent reactor is ${AGENT_REACTOR}, the tasks say ${AGENT}`);
    this.w = w;
  }

  /** Opens `label`: Sam's main chat (`c1`) through the app's route, a side chat through her `Person`. */
  async open(label: ChatLabel): Promise<void> {
    const id = label === "c1" ? ((await this.w.http(sam.email, "GET", "/app/chats")).body.main as string) : ((await this.w.host(sam.email).chats.open(T0)) as { chatId: string }).chatId;
    this.ids.set(label, id);
    this.sockets.set(label, this.harness(label).connect());
  }

  private id(label: ChatLabel): string {
    const id = this.ids.get(label);
    if (!id) throw new Error(`P1_CHAT_NOT_OPEN: ${label}`);
    return id;
  }
  harness(label: ChatLabel = "c1") {
    return this.w.chats.harness(this.id(label));
  }
  chat(label: ChatLabel = "c1") {
    return this.harness(label).instance;
  }
  store(label: ChatLabel = "c1"): ChatStore {
    return (this.chat(label) as unknown as { store: ChatStore }).store;
  }

  /** Sam's message to `label`, the turn run to its end and the background settled. */
  async say(text: string, label: ChatLabel = "c1"): Promise<void> {
    await this.w.say(sam.email, text, this.id(label));
    await this.chat(label).settled();
  }
  /** Sam's `react` frame on `label`, and whatever it starts settled. */
  async react(mid: string, emoji: string, label: ChatLabel = "c1") {
    const r = this.chat(label).react(sam.email, mid, emoji);
    await this.chat(label).settled();
    return r;
  }
  /** A seeded reaction of the agent's, as its outbox would set it (`MessageActions.set` under the agent reactor). */
  seedAgentReaction(mid: string, emoji: string, label: ChatLabel = "c1"): void {
    const store = this.store(label);
    store.transaction(() => store.actions.set(mid, AGENT_REACTOR, emoji, T0));
  }

  reactions(label: ChatLabel = "c1"): ReactionRow[] {
    return this.harness(label)
      .rows("SELECT message_id, person, emoji FROM reactions ORDER BY rowid")
      .map((r) => ({ mid: String(r.message_id), by: String(r.person), emoji: String(r.emoji) }));
  }
  entries(label: ChatLabel = "c1"): Entry[] {
    return this.chat(label).history().entries as Entry[];
  }
  reload(label: ChatLabel = "c1"): Entry[] {
    this.harness(label).evict();
    return this.entries(label);
  }
  turns(label: ChatLabel = "c1"): TurnInfo[] {
    const h = this.harness(label);
    return this.store(label)
      .turns()
      .map((t) => ({ status: t.status, code: t.code, startedBy: h.rows("SELECT kind FROM mailbox WHERE turn_id = ? AND delivery = 'start'", t.id).map((r) => String(r.kind))[0] }));
  }
  mailbox(label: ChatLabel = "c1"): MailInfo[] {
    return this.harness(label)
      .rows("SELECT ordinal, kind, state, delivery FROM mailbox ORDER BY ordinal")
      .map((r) => ({ ordinal: Number(r.ordinal), kind: String(r.kind), state: String(r.state), delivery: r.delivery === null ? null : String(r.delivery) }));
  }
  frames(label: ChatLabel = "c1"): Frame[] {
    return (this.sockets.get(label)?.frames ?? []) as Frame[];
  }
  cards(label: ChatLabel = "c1"): Array<{ state: string }> {
    return (this.chat(label).cardsFor(sam.email) ?? []).map((c) => ({ state: c.state }));
  }
  transcript(label: ChatLabel = "c1"): string[] {
    return this.harness(label)
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => String(r.body));
  }
  requests(): ModelRequest[] {
    return this.w.fake.requests.map((r) => ({
      messages: r.inputs.messages.map((m) => ({
        role: m.role,
        text: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
        tools: ((m.tool_calls as Array<{ name?: string; function?: { name?: string } }> | undefined) ?? []).map((c) => c.function?.name ?? c.name ?? ""),
      })),
    }));
  }
  performed(): string[] {
    return [...this.w.performed];
  }

  /** The append-only rows per opened chat (see `world.ts`) and the R2 keys. */
  snapshot(): Snapshot {
    const journal: string[] = [];
    for (const label of this.ids.keys()) {
      // Visible messages by ordinal and side, not by mid: a mid counts the stored rows, tool calls among them, so the same
      // task reads a different mid under the fake and under the real model; the ordinal is the same in both tiers.
      let n = 0;
      for (const e of this.entries(label)) if (e.kind === "you" || e.kind === "agent") journal.push(`message:${label}:${++n}:${e.kind}`);
      for (const [i] of this.turns(label).entries()) journal.push(`turn:${label}:${i + 1}`);
      for (const m of this.mailbox(label)) journal.push(`mail:${label}:${m.ordinal}:${m.kind}`);
    }
    return { journal, vault: [], r2: [...this.w.r2.objects.keys()] };
  }
}

export interface P1HarnessOptions {
  /** The fake model's script, in the order the setup's and the turns' model calls consume it. */
  script: FakeStep[];
  /** Seeds the records the task names, after `c1` is open and before the snapshot. */
  seed?: (world: P1Tier1World) => Promise<void>;
  world?: Omit<WorldOptions, "script">;
}

/**
 * A `prompt` turn by Sam is `say`; an `event` turn `reaction` is her react frame, and a refused write fails the turn
 * (`P1_REACTION_REFUSED`) so no task passes on a reaction that never landed; anything else is refused by name.
 */
export async function playP1(world: P1Tier1World, turn: Turn): Promise<void> {
  if (turn.kind === "prompt") {
    if (turn.by !== sam.email) throw new Error(`P1_TURN_BY_UNKNOWN: ${turn.by}`);
    await world.say(turn.text);
    return;
  }
  if (turn.kind === "event" && turn.name === "reaction") {
    const p = turn.payload ?? {};
    if (!p.mid || !p.emoji) throw new Error("P1_TURN_PAYLOAD: a reaction event names mid and emoji");
    const r = await world.react(p.mid, p.emoji, (p.chat as ChatLabel | undefined) ?? "c1");
    if (!r.ok) throw new Error(`P1_REACTION_REFUSED: ${r.code}`);
    return;
  }
  throw new Error(`P1_TURN_UNSUPPORTED: ${turn.kind} ${"name" in turn ? turn.name : ""}`);
}

export function p1Harness(o: P1HarnessOptions): TaskHarness<P1Tier1World> {
  return {
    setup: async () => {
      const world = new P1Tier1World(authorityWorld({ script: o.script, ...o.world }));
      await world.open("c1");
      await o.seed?.(world);
      return world;
    },
    play: (world, turn) => playP1(world, turn),
  };
}

/** A scripted `react` call of the agent's. */
export const react = (emoji: string, message?: string) => ({ name: "react", arguments: message ? { emoji, message } : { emoji } });
