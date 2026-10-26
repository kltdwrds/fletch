// The chat engine behind the `Chat` object (AD-1): one per conversation, owned by one person. It
// keeps the transcript, the turns and the outbox in the object's SQLite, runs each turn through the
// turn loop, streams frames to the owner's sockets, and resumes an unfinished turn when its wakeup
// fires after an eviction. It is a plain class over the object's state so the hermetic harness can
// evict it; `objects/chat.ts` is the Agents SDK object that hosts it.
//
// From M3.1 the tools come from the registry: namespaces, two deferral levels, the session's loaded
// set persisted here, and actions performed from the outbox only after the barrier.
import type { JournalRow } from "../grants/journal.ts";
import { treeSpill } from "../tree/spill.ts";
import type { LedgerSink } from "../ledger/types.ts";
import type { Message } from "@earendil-works/pi-ai";
import { createStreamFn } from "../model/adapter.ts";
import { modelConfig, modelFor, type Route } from "../model/routes.ts";
import { log } from "../obs/log.ts";
import { ToolRegistry, ToolSession } from "../tools/registry.ts";
import { coreNamespace } from "../tools/search.ts";
import { reactTool } from "./agent-reaction.ts";
import { compact, type Compacted } from "./compact-turn.ts";
import { type CompactionRecord, ChatStore } from "./store.ts";
import { type TaskAnswer, type TaskReads, type TasksAnswer, taskFor, tasksFor } from "./activity.ts";
import { Approvals, type DecideResult, requestReply, type Tally } from "./approvals.ts";
import { CardStore, type CardView, type Choice } from "./cards.ts";
import type { LinkCard } from "../workspace/surfaces.ts";
import type { ChatFrame, ClaimResult, SendResult, StopResult } from "./frames.ts";
import { LinkShelf } from "./links.ts";
import { Background, markContinuation, RESUME_KEY, startContinuation } from "./resume.ts";
import { ChatGate, type GateState, ownTask, type TurnContext } from "./gate.ts";
import { EffectBuffer } from "./tools.ts";
import { flushOutbox } from "./outbox.ts";
import { type RequestInput, requestContext, requestText, type SendInput } from "./inputs.ts";
import { MAX_STEPS_PER_TURN, runTurnLoop } from "./turn.ts";
import { failureText } from "./failure-words.ts";
import type { HistorySnapshot } from "./history.ts";
import { admitTurn } from "./admission.ts";
import { assembleTurn, liveTranscript } from "./assemble-turn.ts";
import type { EngineCtx, EngineHooks, Wakeup } from "./hooks.ts";
import { clientIdOf, Mailbox, type MailRow, serverId } from "./mailbox.ts";
import { ChatMessageActions, type ReactResult } from "./message-actions.ts";
import { Projections } from "./projection.ts";
import { stopKey } from "./stop.ts";
import { openTurn } from "./intake.ts";
import { pendingQuestion, reactionRow } from "./reaction-input.ts";
import { noteOpenTodos } from "./todo.ts";
import type { TurnEndRow } from "../ledger/types.ts";
import type { ViewResult } from "../views/select.ts";
import { chatNamespaces } from "./session.ts";
import { endStopped, placedEntries, queryOwnedView, recordTurnEnd, stoppedEntry } from "./steering.ts";

export type { ChatView, EngineCtx, EngineHooks, Wakeup } from "./hooks.ts";
export type { RequestInput, SendInput } from "./inputs.ts";

export type { ChatFrame, ClaimResult, SendResult } from "./frames.ts";

/** How long a running turn may go quiet before its alarm resumes it in a fresh instance. */
export const RESUME_AFTER_MS = 30_000;
/** The chat meta key holding the namespaces loaded for this session. */
export const LOADED_NAMESPACES_KEY = "toolNamespaces";

export class ChatEngine {
  private readonly ctx: EngineCtx;
  private readonly env: Env;
  private readonly wakeup: Wakeup;
  private readonly sockets: () => Iterable<{ send(data: string): void }>;
  private readonly hooks: EngineHooks;
  private storeInstance?: ChatStore;
  private cardsInstance?: CardStore;
  private activeTurn?: string;
  /** Clock and retry wait; tests replace them on the instance rather than sleeping. */
  now: () => number = () => Date.now();
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** The model call's bounds (M19.1) run on this; tests fire them instead of waiting. */
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => ((t) => () => clearTimeout(t))(setTimeout(fn, ms));
  /** Decisions running in this instance, by card id (M20.1). */
  private readonly inflight = new Map<string, Promise<DecideResult>>();
  /** Reply text streamed per turn, said on `turn_done` (M19.1) so a page that drew less asks for the history. */
  private readonly replyChars = new Map<string, number>();

  constructor(ctx: EngineCtx, env: Env, hooks: EngineHooks = {}) {
    this.ctx = ctx;
    this.env = env;
    this.hooks = hooks;
    this.wakeup = hooks.wakeup ?? { arm: (at) => ctx.storage.setAlarm(at), disarm: () => ctx.storage.deleteAlarm() };
    this.sockets = hooks.sockets ?? (() => ctx.getWebSockets());
  }

  private get store(): ChatStore {
    this.storeInstance ??= new ChatStore(this.ctx.storage as DurableObjectStorage);
    return this.storeInstance;
  }

  private get cards(): CardStore {
    this.cardsInstance ??= new CardStore(this.ctx.storage);
    return this.cardsInstance;
  }

  private mailboxInstance?: Mailbox;
  private get mailbox(): Mailbox {
    this.mailboxInstance ??= new Mailbox(this.ctx.storage.sql, this.store);
    return this.mailboxInstance;
  }

  private projectionsInstance?: Projections;
  private get projections(): Projections {
    this.projectionsInstance ??= new Projections(this.ctx.storage.sql);
    return this.projectionsInstance;
  }

  /** True from a send's first await until its turn runs, so a second send in that gap is queued, not a second turn. */
  private opening = false;
  private busy(): boolean {
    return this.opening || !!this.activeTurn || !!this.store.runningTurn();
  }

  private readonly links = new LinkShelf(() => this.store, (f) => this.broadcast(f), () => this.now());
  private readonly messages = new ChatMessageActions(() => this.store, () => this.owner(), () => this.history().entries, (f) => this.broadcast(f), () => this.now());

  /** The person who owns this chat, once claimed. */
  owner(): string | null { return this.store.meta("owner") ?? null; }

  /** Records the owner on first claim; a claim by anyone else is refused. */
  claim(person: string): ClaimResult {
    const owner = this.owner();
    if (owner && owner !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    if (!owner) this.store.transaction(() => this.store.setMeta("owner", person));
    return { ok: true };
  }

  /** The namespaces loaded for this session, as persisted. */
  loadedNamespaces(): string[] {
    return JSON.parse(this.store.meta(LOADED_NAMESPACES_KEY) ?? "[]") as string[];
  }

  /**
   * A job's message (M5.1) or the owner's received mail (M6.1) for this chat's owner: kept once per id,
   * so a redelivery after an unknown outcome shows nothing twice; it joins the transcript so the next
   * turn sees it, and goes to the owner's sockets. Only the owner's own jobs and mail deliver here.
   */
  notify(n: { id: string; source: string; text: string; person: string }): { ok: true; duplicate: boolean } | { ok: false; code: "CHAT_NOT_OWNER"; reason: string } {
    if (this.owner() !== n.person) return { ok: false, code: "CHAT_NOT_OWNER", reason: "a job or mail delivers only into its owner's chat" };
    const at = this.now();
    let added = false;
    this.store.transaction(() => {
      added = this.store.addNotice(n.id, n.source, n.text, at);
      const origin = n.source.startsWith("mail:") ? `Mail that arrived for the person (${n.source})` : `Message from your scheduled job (${n.source})`;
      if (added) this.store.appendMessage(`notice:${n.id}`, { role: "system", content: `${origin}, already shown to the person:\n${n.text}`, timestamp: at });
    });
    if (added) for (const socket of this.sockets()) socket.send(JSON.stringify({ type: "notice", id: n.id, source: n.source, text: n.text } satisfies ChatFrame));
    return { ok: true, duplicate: !added };
  }

  hasNotice(id: string): boolean { return this.store.hasNotice(id); }

  /** What the page draws on open, reconnect and check (M15.5, M18.1), cards and the running turn included; who may read it is `connectFrame`'s decision. */
  history(): HistorySnapshot {
    const approvals = this.approvals();
    return { entries: this.store.history(this.cards.list().map((c) => ({ kind: "card" as const, ...((v) => ({ text: v.title, card: v }))(approvals.view(c)), at: c.createdAt })), placedEntries(this.store, this.mailbox)), running: this.store.running() };
  }

  notices(): Array<{ id: string; source: string; text: string; at: number }> { return this.store.notices(); }

  /** The chat's compaction records for its owner alone (M15.2, read by the dashboard); null for anyone else. */
  compactionsFor(person: string): CompactionRecord[] | null { return this.owner() === person ? this.store.compactions() : null; }

  /** The notices for the chat's owner alone; null for anyone else. */
  noticesFor(person: string): Array<{ id: string; source: string; text: string; at: number }> | null { return this.owner() === person ? this.store.notices() : null; }

  /**
   * Takes the owner's message (M24.2): stored as a mailbox row first, keyed on the page's id for the send,
   * so the same frame again is answered with the first row. While a turn runs the row waits for that
   * turn's next step boundary; otherwise it starts a turn and runs it to its end.
   */
  async send(input: SendInput): Promise<SendResult> {
    if (!input.text.trim()) return { status: "refused", code: "EMPTY_MESSAGE" };
    const owner = this.store.meta("owner");
    if (owner && owner !== input.person) return { status: "refused", code: "CHAT_NOT_OWNER" };
    const id = input.clientId ?? serverId();
    const seen = this.mailbox.byId(id);
    if (seen) return { status: "duplicate", id, ordinal: seen.ordinal, state: seen.state };
    const queue = this.busy();
    if (!queue) this.opening = true;
    try {
      // A typed secret goes to the Vault before anything is stored or logged; failing that, nothing is.
      const held = this.hooks.secrets ? await this.hooks.secrets(input.person, input.text) : { ok: true as const, text: input.text };
      if (!held.ok) return { status: "refused", code: held.code };
      const quoted = this.messages.quote(input.quote);
      if (!quoted.ok) return { status: "refused", code: quoted.code };
      const at = this.now();
      const { row, duplicate } = this.store.transaction(() => {
        if (!owner) this.store.setMeta("owner", input.person);
        return quoted.keep(id, this.mailbox.accept({ messageId: id, kind: "user", scope: "owner", person: input.person, text: quoted.lead + held.text, ...(input.timeZone ? { timeZone: input.timeZone } : {}), at }));
      });
      if (duplicate) return { status: "duplicate", id, ordinal: row.ordinal, state: row.state };
      const running = this.activeTurn ?? this.store.runningTurn()?.id;
      if (queue && running) {
        this.broadcast({ type: "queued", turn: running, ordinal: row.ordinal, text: held.text, mid: `q${row.ordinal}`, ...(input.clientId ? { id } : {}) });
        return { status: "queued", id, ordinal: row.ordinal, turnId: running };
      }
      return await this.begin(row, false);
    } finally {
      if (!queue) this.opening = false;
    }
  }

  /** Starts the turn a person's row asks for; `queued` when it waited in the mailbox, so a refusal still says what happened. */
  private async begin(row: MailRow, queued: boolean): Promise<SendResult> {
    const opened = await openTurn({ store: this.store, mailbox: this.mailbox, hooks: this.hooks, ledger: this.ledger(), tenant: this.env.TENANT_ID, now: this.now, models: modelConfig(this.env) }, row, queued);
    if (opened.kind === "refused") return { status: "refused", code: opened.code };
    // Stored as running now, which marks the chat busy; a drain when it ends must not see it still opening.
    this.opening = false;
    // A reaction's turn names no words of the person's (F10): the page draws it as a continuation.
    if (row.kind === "reaction") this.broadcast({ type: "turn_started", turn: opened.turnId });
    else this.started(opened.turnId, this.store.actions.shown(row.messageId, row.text), opened.mid, clientIdOf(row));
    // The person's message is kept with its failure, so a re-sync draws both.
    if (opened.failed) return this.failTurn(opened.turnId, opened.failed.code, opened.failed.reason);
    await this.wakeup.arm(opened.at + RESUME_AFTER_MS);
    return this.runTurn(opened.turnId, row.person, true);
  }

  /** The first queued row starts a turn once none runs (the rest wait for its step boundaries); work left running. */
  private async drain(): Promise<void> {
    const next = this.busy() ? undefined : this.mailbox.queued()[0];
    if (!next) return;
    this.opening = true;
    try {
      if (next.kind === "internal_handoff") await this.beginHandoff(next);
      else await this.begin(next, true);
    } finally {
      this.opening = false;
    }
  }

  /**
   * Stops the running turn at its next step boundary (M24.2), for the owner alone. A turn this instance
   * is not running (evicted, waiting for its resume) has no step in flight, so it ends stopped at once.
   */
  async stop(person: string): Promise<StopResult> {
    if (this.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    const turn = this.store.runningTurn();
    if (!turn) return { ok: false, code: "NO_TURN_RUNNING" };
    this.store.transaction(() => this.store.setMeta(stopKey(turn.id), String(this.now())));
    this.broadcast({ type: "turn_stopping", turn: turn.id });
    if (this.activeTurn !== turn.id) {
      this.store.transaction(() => endStopped(this.store, this.mailbox, turn.id, [], this.now()));
      await this.endStopped(turn.id, person, turn.steps);
    }
    return { ok: true, turn: turn.id };
  }

  /** Says the stop on the owner's sockets and records it in the Ledger. */
  private async endStopped(turnId: string, person: string, steps: number): Promise<SendResult> {
    await this.wakeup.disarm();
    this.broadcast({ type: "turn_stopped", turn: turnId, ...stoppedEntry(this.store, this.mailbox, turnId) });
    await this.turnEnded({ person, chatId: this.chatId(), turnId, outcome: "stopped", steps, at: this.now() });
    return { status: "stopped", turnId };
  }

  private turnEnded = (row: TurnEndRow): Promise<void> => recordTurnEnd(this.store, this.ledger(), row);

  /** The person compacts this chat from the agent sheet (M24.2); refused while a turn runs. */
  async compactNow(person: string): Promise<{ ok: true; record: CompactionRecord } | { ok: false; code: string; reason: string }> {
    if (this.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER", reason: "only the chat's owner compacts it" };
    if (this.busy()) return { ok: false, code: "TURN_IN_PROGRESS", reason: "a turn is running; compact once it ends" };
    const runId = `compact:${crypto.randomUUID()}`;
    const r: Compacted = await compact(this.store, this.streamFn("compaction", person, runId), runId, this.now(), "manual");
    if (!r.ok) return { ok: false, code: r.code, reason: r.detail };
    return r.record ? { ok: true, record: r.record } : { ok: false, code: "NOTHING_TO_COMPACT", reason: "there was nothing to fold into a summary" };
  }

  /** The chat was reopened (unarchived) by its owner's `Person`: a new conversation epoch (M24.2). */
  reopen(person: string): { ok: true; epoch: number } | { ok: false; code: "CHAT_NOT_OWNER" } {
    if (this.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    return { ok: true, epoch: this.store.transaction(() => this.mailbox.advanceEpoch()) };
  }

  private queryView(person: string, input: { view: string; sql: string }): Promise<ViewResult> {
    return queryOwnedView({ owner: this.owner(), sql: this.ctx.storage.sql, ledger: () => this.ledger() }, person, input);
  }

  /** Tells the owner's sockets the person's message is stored and its turn runs (M18.1). */
  private started = (turn: string, text: string, mid: string, id?: string) => this.broadcast({ type: "turn_started", turn, text, mid, ...(id ? { id } : {}) });

  /**
   * Runs a colleague's request as a turn of this chat's owner's agent (M7.1). The request enters as
   * input labeled by code, fenced with the sender as its source; the turn's context carries the
   * colleague as counterpart with the request's origin and hops, so the gate decides every call
   * against the grants the owner wrote. The reply is code's, from what the turn did.
   */
  async request(input: RequestInput): Promise<{ status: string; text: string } | { status: "refused"; code: string }> {
    const owner = this.owner();
    if (owner !== input.person) return { status: "refused", code: "CHAT_NOT_OWNER" };
    if (this.busy()) return { status: "refused", code: "TURN_IN_PROGRESS" };
    const turnId = crypto.randomUUID();
    const context = requestContext(input);
    const name = this.nameOf(owner);
    const at = this.now();
    this.store.transaction(() => {
      this.store.startTurn(turnId, owner, at);
      if (!this.store.transcript().length) this.store.setMeta("surface", "request");
      this.store.setMeta(`context:${turnId}`, JSON.stringify(context));
      this.store.setMeta(`requestText:${turnId}`, input.text);
      this.store.appendMessage(turnId, { role: "user", content: requestText(input, name, (e) => this.nameOf(e)), timestamp: at });
    });
    await this.wakeup.arm(at + RESUME_AFTER_MS);
    const ran = await this.runTurn(turnId, owner);
    if (ran.status === "refused") return { status: "refused", code: ran.code };
    return requestReply(name, this.tallyOf(turnId));
  }

  /**
   * The handoff of a delegation's sub-agents (M7.2), labelled by code: an `internal_handoff` mailbox row
   * (M24.2), keyed on the delegation so the host's retry is answered with the first row. It reaches a
   * running turn at its next step boundary, or runs as a turn of the owner's own task.
   */
  async handoff(h: { grp: string; person: string; text: string }): Promise<SendResult> {
    if (this.owner() !== h.person) return { status: "refused", code: "CHAT_NOT_OWNER" };
    const id = `handoff:${h.grp}`;
    const { row, duplicate } = this.store.transaction(() => this.mailbox.accept({ messageId: id, kind: "internal_handoff", scope: `delegation:${h.grp}`, person: h.person, text: h.text, at: this.now() }));
    if (duplicate) return { status: "duplicate", id, ordinal: row.ordinal, state: row.state };
    const running = this.activeTurn ?? this.store.runningTurn()?.id;
    if (running || this.opening) return { status: "queued", id, ordinal: row.ordinal, turnId: running ?? "" };
    return this.beginHandoff(row);
  }

  private async beginHandoff(row: MailRow): Promise<SendResult> {
    const turnId = crypto.randomUUID();
    const at = this.now();
    this.store.transaction(() => {
      this.store.startTurn(turnId, row.person, at);
      this.mailbox.started(row.ordinal, turnId, this.store.appendMessage(turnId, { role: "user", content: row.text, timestamp: at }), at);
    });
    await this.wakeup.arm(at + RESUME_AFTER_MS);
    return this.runTurn(turnId, row.person);
  }

  /** The pending and decided cards, rendered by the harness, for the chat's owner or an admin's company cards. */
  cardsFor(person: string): CardView[] | null {
    if (this.owner() !== person) return null;
    return this.cards.list().map((c) => this.approvals().view(c));
  }

  /** The person's reaction, stored and broadcast; on the agent's pending question also their answer (F10), taken in the background. */
  react(person: string, mid: string, emoji: string): ReactResult {
    const r = this.messages.react(person, mid, emoji);
    const set = r.ok ? r.emoji : null;
    const asked = set ? pendingQuestion(this.history().entries, this.store.turns(), mid, (t) => this.mailbox.startedBy(t)) : null;
    // The decision is visible in Workers Logs: an answer starts a turn, anything else is ambient (no turn).
    if (set) log("chat.reaction", { outcome: asked ? "answer" : "ambient", onPending: asked?.mid === mid, mid });
    if (set && asked) {
      this.store.transaction(() => this.mailbox.accept(reactionRow(person, this.nameOf(person), set, asked, this.now())));
      this.defer(this.drain()); // a turn running or opening takes the row at its next step boundary instead
    }
    return r;
  }

  /** When the chat last had something to show (M29.3), for its owner alone; anyone else is refused. */
  lastAt(person: string): { ok: true; at: number | null } | { ok: false; code: "CHAT_NOT_OWNER" } {
    if (this.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    return { ok: true, at: this.store.lastAt() };
  }

  /** The chat's tasks (F12), its newest first, and one by its anchor turn: for its owner alone, anyone else refused with a code. */
  tasksFor(person: string): TasksAnswer { return tasksFor(this.taskReads, person); }
  taskFor(person: string, id: string): TaskAnswer { return taskFor(this.taskReads, person, id); }
  private get taskReads(): TaskReads { return { owner: this.owner(), chatId: this.chatId(), store: this.store, mailbox: this.mailbox, cards: this.cards }; }

  /** The link cards this chat showed its owner (M16.2); they carry no choices. */
  linksFor(person: string): LinkCard[] | null {
    return this.links.list(this.owner(), person);
  }

  /**
   * Decides cards; `agent` marks an agent session, which never decides. A decision that settles the last
   * card a paused turn waited on continues that turn on its own (M20.1); a repeated one changes nothing.
   */
  async decide(ids: string[], by: { person: string; agent: boolean }, choice: Choice): Promise<DecideResult[]> {
    const results = await this.approvals().decide(ids, by, choice);
    markContinuation(this.store, this.cards, results, (t) => this.contextOf(t, "").counterpart.kind === "own-agent");
    await this.continueIfDue();
    if (!this.hooks.defer) await this.settled();
    return results;
  }

  /** Runs the continuation a decision left due, once no turn runs; the turn itself runs in the background. */
  private async continueIfDue(): Promise<void> {
    const owner = this.owner();
    if (!owner || this.activeTurn) return;
    const at = this.now();
    const turnId = startContinuation(this.store, owner, at);
    if (!turnId) return;
    this.broadcast({ type: "turn_started", turn: turnId });
    await this.wakeup.arm(at + RESUME_AFTER_MS);
    this.defer(this.runTurn(turnId, owner));
  }

  /** Work a call leaves running (a continued turn); without a host `defer` the decide call waits for it. */
  private readonly background = new Background((p) => this.hooks.defer?.(p));
  private defer = (p: Promise<unknown>) => this.background.add(p);
  settled = () => this.background.settled();

  /** The person clears the task's restricted latch. */
  clearLatch(person: string): { ok: true } | { ok: false; code: "CHAT_NOT_OWNER" } {
    if (this.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    const turn = this.store.turns().at(-1);
    if (turn) this.store.transaction(() => this.store.setMeta(`latch:${turn.id}`, ""));
    return { ok: true };
  }

  /** Resumes a turn an eviction interrupted; a turn still running here only re-arms the wakeup. */
  async alarm(): Promise<void> {
    if (this.activeTurn) {
      await this.wakeup.arm(this.now() + RESUME_AFTER_MS);
      return;
    }
    const turn = this.store.runningTurn();
    if (turn) await this.runTurn(turn.id, turn.person);
    else await this.drain();
  }

  private ledger(): LedgerSink {
    return this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID));
  }

  private streamFn(route: Route, person: string, runId: string) {
    return createStreamFn({ ai: this.env.AI, ledger: this.ledger(), wait: this.wait, now: this.now, schedule: this.schedule, models: modelConfig(this.env) }, { tenant: this.env.TENANT_ID, person, runId, route });
  }

  private nameOf(email: string): string {
    return this.hooks.nameOf?.(email) ?? email;
  }

  private contextOf(turnId: string, person: string): TurnContext {
    const raw = this.store.meta(`context:${turnId}`);
    return raw ? (JSON.parse(raw) as TurnContext) : ownTask(person);
  }

  private tallyOf(turnId: string): Tally {
    return { done: 0, pending: 0, refused: 0, ...JSON.parse(this.store.meta(`tally:${turnId}`) ?? "{}") };
  }

  /** The gate's view of this chat for one turn: the latch, the cards, outside content read. */
  private gateState(turnId: string): GateState {
    return {
      latched: () => !!this.store.meta(`latch:${turnId}`),
      latch: (source) => this.store.transaction(() => this.store.setMeta(`latch:${turnId}`, source)),
      card: (fp) => this.cards.byFingerprint(fp),
      sawExternal: false,
      awaiting: false,
    };
  }

  private approvals(): Approvals {
    return new Approvals({
      tenant: this.env.TENANT_ID,
      chatId: this.chatId(),
      cards: this.cards,
      inflight: this.inflight,
      journal: (row: JournalRow) => (this.ledger() as LedgerSink & { journal(r: JournalRow): Promise<unknown> }).journal(row),
      frame: (f) => this.broadcast(f as ChatFrame),
      session: (context) => this.toolSession(this.owner() ?? "", this.links.performed(), context, this.gateState("decision")),
      ...(this.hooks.authority ? { authority: this.hooks.authority } : {}),
      ...(this.hooks.company ? { company: this.hooks.company } : {}),
      note: (id, text) => this.store.transaction(() => this.store.appendMessage(`decision:${id}`, { role: "system", content: text, timestamp: this.now() } as never)),
      tally: (turnId, add) => {
        const t = this.tallyOf(turnId);
        this.store.transaction(() => this.store.setMeta(`tally:${turnId}`, JSON.stringify({ done: t.done + (add.done ?? 0), pending: t.pending + (add.pending ?? 0), refused: t.refused + (add.refused ?? 0) })));
      },
      reply: async (card, text) => {
        const to = JSON.parse(this.store.meta(`context:${card.turnId}`) ?? "null") as TurnContext | null;
        const target = to?.request?.replyTo;
        if (target && this.hooks.colleagues) await this.hooks.colleagues.deliverReply(target.chatId, { id: `colleague-update:${this.chatId()}:${card.id}`, source: `colleague:${card.descriptor.principal}`, text, person: target.person });
      },
      nameOf: (e) => this.nameOf(e),
      label: (tool) => tool.replaceAll("_", " "),
      now: () => this.now(),
    });
  }

  /** The registry for one turn: every namespace this chat can offer, the session over the persisted loads. */
  private toolSession(person: string, effects: EffectBuffer, context: TurnContext = ownTask(person), state?: GateState): ToolSession {
    let session: ToolSession | undefined;
    const core = coreNamespace(
      effects,
      () => session as ToolSession,
      (loaded) => this.store.transaction(() => this.store.setMeta(LOADED_NAMESPACES_KEY, JSON.stringify([...loaded]))),
      reactTool(effects, () => this.history().entries),
    );
    const gateState = state ?? this.gateState("none");
    const namespaces = [core, ...chatNamespaces({ store: this.store, hooks: this.hooks, chatId: this.chatId(), now: () => this.now(), schedule: this.schedule, owner: () => this.owner(), pending: () => this.cards.simulatedPending(), queryView: (i) => this.queryView(person, i), card: (id) => this.cards.get(id) }, person, effects, context, gateState)];
    const gate = new ChatGate({ principal: person, context, ...(this.hooks.authority ? { authority: this.hooks.authority(person) } : {}), effects, state: gateState, now: () => this.now(), nameOf: (e) => this.nameOf(e) });
    session = new ToolSession(new ToolRegistry(namespaces), this.loadedNamespaces(), gate, treeSpill(this.hooks.tree?.(person), person));
    return session;
  }

  /** `admitted` when the caller already asked the Ledger for this turn; otherwise it is asked first. */
  private async runTurn(turnId: string, person: string, admitted = false): Promise<SendResult> {
    this.activeTurn = turnId;
    try {
      // A turn stopped while it was being started (the stop found no step in flight) never runs.
      const status = this.store.turn(turnId)?.status;
      if (status !== "running") return status === "stopped" ? { status: "stopped", turnId } : { status: "done", turnId };
      if (!admitted) {
        const a = await admitTurn(this.ledger(), { tenant: this.env.TENANT_ID, person, turnId, model: modelFor("chat", modelConfig(this.env)).id }, this.now);
        if (!a.ok) return this.failTurn(turnId, a.code, a.reason);
      }
      const effects = new EffectBuffer();
      const state = this.gateState(turnId);
      const session = this.toolSession(person, effects, this.contextOf(turnId, person), state);
      await this.flushOutbox(session);
      const model = modelFor("chat", modelConfig(this.env));
      // A resumed step replays the blocks its turn assembled (M24.2), so it is the step it replaces.
      let messages: Message[];
      if (this.projections.has(turnId)) {
        const replayed = this.projections.replay(turnId, liveTranscript(this.store), session.tools);
        if (!replayed.ok) return this.failTurn(turnId, replayed.code, replayed.detail);
        messages = replayed.messages;
      } else {
        const deps = { store: this.store, hooks: this.hooks, projections: this.projections, now: this.now, streamFn: (r: Route, p: string, id: string) => this.streamFn(r, p, id), context: this.contextOf(turnId, person) };
        const assembled = await assembleTurn(deps, turnId, person, session, model.id);
        if (!assembled.ok) return this.failTurn(turnId, assembled.code, assembled.detail);
        messages = assembled.messages;
      }
      const steered: Message[] = [];
      const outcome = await runTurnLoop({
        turnId,
        conversation: this.chatId(),
        model,
        streamFn: this.streamFn("chat", person, turnId),
        tools: session.tools,
        effects,
        messages,
        maxSteps: MAX_STEPS_PER_TURN,
        onFrame: (frame) => this.broadcast(frame),
        pauseAfter: () => state.awaiting,
        barrier: (step) =>
          this.store.transaction(() => {
            this.store.appendMessage(turnId, step.message);
            for (const r of step.toolResults) this.store.appendMessage(turnId, r);
            const tokens = step.message.usage.input + step.message.usage.output;
            // Once the person asked to stop, what this step proposed is not committed; the transcript says so.
            if (!step.stopped) for (const e of step.effects) this.store.queue(turnId, e.kind === "deliver" || e.kind === "link" || e.kind === "react" ? e : { ...e, tokens });
            this.store.recordStep(turnId, step.message.usage.input);
            if (step.steer) steered.push(...[this.mailbox.steer(turnId, this.now(), (m) => this.store.appendMessage(`mailbox:${turnId}`, m))].flatMap((m) => m ?? []));
            if (step.final) this.store.endTurn(turnId, "done", null, this.now());
            if (step.paused) this.store.endTurn(turnId, "done", "AWAITING_DECISION", this.now());
            if (step.stopped) endStopped(this.store, this.mailbox, turnId, step.effects, this.now());
          }),
        afterBarrier: () => this.flushOutbox(session),
        stopRequested: () => !!this.store.meta(stopKey(turnId)),
        queued: () => this.mailbox.hasQueued(),
        steering: () => steered.splice(0),
      });
      if (outcome.status === "failed") return this.failTurn(turnId, outcome.code, outcome.detail);
      if (outcome.stopped) return this.endStopped(turnId, person, this.store.turn(turnId)?.steps ?? outcome.steps);
      await this.wakeup.disarm();
      if (!outcome.paused) this.store.transaction(() => noteOpenTodos(this.store));
      this.broadcast({ type: "turn_done", turn: turnId, chars: this.replyChars.get(turnId) ?? 0 });
      return outcome.paused ? { status: "done", turnId, awaiting: true } : { status: "done", turnId };
    } finally {
      this.activeTurn = undefined;
      this.replyChars.delete(turnId);
      // A decision made meanwhile continues its turn, then a queued row starts the next; read later, as a throw here would orphan the answer.
      this.defer(Promise.resolve().then(async () => {
        if (this.store.meta(RESUME_KEY)) await this.continueIfDue();
        await this.drain();
      }));
    }
  }

  private chatId(): string {
    return this.ctx.id?.name ?? this.ctx.id?.toString() ?? "unknown";
  }

  /** Ends a turn failed: its code and reason persist on the turn's row, so history draws it on every re-sync (M17.1). */
  private async failTurn(turnId: string, code: string, detail: string): Promise<SendResult> {
    this.store.transaction(() => this.store.endTurn(turnId, "failed", code, this.now(), detail));
    await this.wakeup.disarm();
    const turn = this.store.turn(turnId);
    if (code === "TURN_STEP_LIMIT" && turn) await this.turnEnded({ person: turn.person, chatId: this.chatId(), turnId, outcome: "step_limit", steps: turn.steps, at: this.now() });
    this.broadcast({ type: "turn_failed", turn: turnId, code, reason: detail, text: failureText(code) });
    return { status: "failed", turnId, code, detail };
  }

  /** Releases this chat's committed effects (`outbox.ts`). */
  private flushOutbox = (session: ToolSession) => flushOutbox({ store: this.store, links: this.links, approvals: () => this.approvals(), broadcast: (f) => this.broadcast(f), subagents: this.hooks.subagents, owner: () => this.owner(), react: (mid, emoji) => this.messages.reactAsAgent(mid, emoji), now: this.now }, session);

  private broadcast(frame: ChatFrame): void {
    // A turn about to say it ended first names what it drew live (M29.4), so the page offers those messages' actions.
    if (frame.type === "turn_done" || frame.type === "turn_failed" || frame.type === "turn_stopped") this.messages.name(frame.turn);
    if (frame.type === "delta" || frame.type === "message") this.replyChars.set(frame.turn, (this.replyChars.get(frame.turn) ?? 0) + frame.text.length);
    const data = JSON.stringify(frame);
    for (const ws of this.sockets()) {
      try {
        ws.send(data);
      } catch {
        // A closed socket misses live frames; the transcript and outbox stay the record.
      }
    }
  }
}
