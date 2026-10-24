// The Chat object's SQLite: transcript, turns and the outbox. Every write that belongs to a step
// happens inside the barrier's transaction, so a crash leaves either the whole step or none of it.
import type { Message } from "@earendil-works/pi-ai";
import { type FailedTurn, type HistoryEntry, type PlacedEntry, type Reaction, type TranscriptRow, TYPED_WITHOUT_ID, visibleHistory } from "./history.ts";
import { AGENT_REACTOR, MessageActions } from "./message-actions.ts";
import type { Effect } from "./tools.ts";
import type { LinkCard } from "../workspace/surfaces.ts";
import { CHAT_MIGRATIONS } from "../migrations/catalog.ts";
import { migrate } from "../migrations/engine.ts";


/**
 * One compaction (Muse spec §15.1): where the prompt was when it fired, the first message kept verbatim,
 * the input tokens of the step that triggered it and of the first step after it (null until that step
 * has run), and why it fired.
 */
export interface CompactionRecord {
  id: number;
  turnId: string;
  checkpointSeq: number;
  firstKeptSeq: number;
  tokensBefore: number;
  tokensAfter: number | null;
  /** `manual` when the person asked for it from the agent sheet (M24.2). */
  trigger: CompactionTrigger;
  at: number;
  /** A compaction that failed is a row with its code and reason, never silence (M24.2). */
  status: "done" | "failed";
  code: string | null;
  reason: string | null;
}

export type CompactionTrigger = "threshold" | "manual";

export type TurnStatus = "running" | "done" | "failed" | "stopped";

export type TurnRow = {
  id: string;
  person: string;
  status: TurnStatus;
  code: string | null;
  reason: string | null;
  steps: number;
  input_tokens: number;
  started_at: number;
  ended_at: number | null;
};

export type OutboxRow = {
  id: string;
  turn_id: string;
  payload: string;
  delivered_at: number | null;
};

export class ChatStore {
  private readonly storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
    migrate(storage, CHAT_MIGRATIONS);
  }

  private get sql() {
    return this.storage.sql;
  }

  /** The reactions and quotes of this chat's messages (M29.4). */
  get actions(): MessageActions {
    return new MessageActions(this.sql);
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  /** Records a job's notice once per id; false when it was already here. */
  addNotice(id: string, source: string, text: string, at: number): boolean {
    if (this.hasNotice(id)) return false;
    this.sql.exec("INSERT INTO notices (id, source, text, at) VALUES (?, ?, ?, ?)", id, source, text, at);
    return true;
  }

  hasNotice(id: string): boolean {
    return this.sql.exec("SELECT id FROM notices WHERE id = ?", id).toArray().length > 0;
  }

  notices(): Array<{ id: string; source: string; text: string; at: number }> {
    return this.sql.exec<{ id: string; source: string; text: string; at: number }>("SELECT id, source, text, at FROM notices ORDER BY at, id").toArray();
  }

  /** Records a link card once per card id (M16.2); false when this chat already shows it. */
  addLink(turnId: string, card: LinkCard, at: number): boolean {
    if (this.sql.exec("SELECT id FROM links WHERE id = ?", card.id).toArray().length) return false;
    this.sql.exec("INSERT INTO links (id, turn_id, card, at) VALUES (?, ?, ?, ?)", card.id, turnId, JSON.stringify(card), at);
    return true;
  }

  links(): LinkCard[] {
    return this.sql.exec<{ card: string }>("SELECT card FROM links ORDER BY at, rowid").toArray().map((r) => JSON.parse(r.card) as LinkCard);
  }

  meta(key: string): string | undefined {
    return this.sql.exec<{ value: string }>("SELECT value FROM chat_meta WHERE key = ?", key).toArray()[0]?.value;
  }

  setMeta(key: string, value: string): void {
    this.sql.exec("INSERT INTO chat_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  /**
   * `typed` marks the person's own message, the only user input the page draws back (M15.5); a string
   * is the page's id for the send (M18.1), kept so a re-sync tells the page the send was stored.
   */
  appendMessage(turnId: string, message: Message, typed: boolean | string = false): number {
    const seq = this.sql.exec<{ seq: number }>("INSERT INTO messages (turn_id, role, body) VALUES (?, ?, ?) RETURNING seq", turnId, message.role, JSON.stringify(message)).one().seq;
    if (typed) this.setMeta(`typed:${turnId}`, typeof typed === "string" ? typed : TYPED_WITHOUT_ID);
    return seq;
  }

  /**
   * What the page draws when it opens this chat: the person's turns and the agent's words, in order,
   * with the cards the chat showed (`cards`, rendered by the engine's approvals) among them.
   */
  history(cards: Array<Extract<HistoryEntry, { kind: "card" }>> = [], placed: PlacedEntry[] = []): HistoryEntry[] {
    const rows = this.sql
      .exec<{ seq: number; turn_id: string; body: string }>("SELECT seq, turn_id, body FROM messages WHERE compacted = 0 ORDER BY seq")
      .toArray()
      .map((r): TranscriptRow => ({ seq: r.seq, turnId: r.turn_id, message: JSON.parse(r.body) as Message }));
    const typed = new Map(this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM chat_meta WHERE key LIKE 'typed:%'").toArray().map((r) => [r.key.slice("typed:".length), r.value] as const));
    const delivered = new Set(this.sql.exec<{ id: string }>("SELECT id FROM outbox").toArray().map((r) => r.id));
    const links = this.sql.exec<{ card: string; at: number }>("SELECT card, at FROM links ORDER BY at, rowid").toArray().map((r) => {
        const card = JSON.parse(r.card) as LinkCard;
        return { kind: "link" as const, text: card.title, at: r.at, card };
      });
    const announced = this.sql
      .exec<{ id: string; turn_id: string; payload: string }>("SELECT id, turn_id, payload FROM outbox WHERE id LIKE '%:announce' ORDER BY rowid")
      .toArray()
      .flatMap((r) => {
        const text = (JSON.parse(r.payload) as { text?: unknown }).text;
        return typeof text === "string" && text ? [{ callId: r.id.slice(0, -":announce".length), turnId: r.turn_id, text }] : [];
      });
    return this.withActions(visibleHistory(rows, typed, delivered, this.notices(), this.failedTurns(), [...cards, ...links], announced, placed));
  }

  /**
   * The reactions on each message, and on a reply its quote, drawn above it, with the reply's text the person's own
   * words alone (M29.4). A reaction is drawn by who put it there: the agent's first, then the owner's (F10), so the
   * pill reads the same on every reload. Anyone else's is never drawn: the chat answers its owner. Reactions never
   * enter the transcript: the model reads the standing ones in each turn's envelope (`reactionsLead`).
   */
  private withActions(entries: HistoryEntry[]): HistoryEntry[] {
    const actions = this.actions;
    const owner = this.meta("owner");
    const all = actions.reactionsByMessage();
    const drawn = (mid: string): Reaction[] => {
      const list = all.get(mid) ?? [];
      const of = (person: string | undefined, by: Reaction["by"]) => list.filter((r) => person !== undefined && r.by === person).map((r) => ({ by, emoji: r.emoji }));
      return [...of(AGENT_REACTOR, "agent"), ...of(owner, "you")];
    };
    return entries.map((e) => {
      if (e.kind !== "you" && e.kind !== "agent") return e;
      const reactions = drawn(e.mid);
      const q = e.kind === "you" && e.id ? actions.quoteOf(e.id) : undefined;
      const text = q && e.text.startsWith(q.lead) ? e.text.slice(q.lead.length) : e.text;
      return { ...e, text, ...(reactions.length ? { reactions } : {}), ...(q ? { quote: { mid: q.quoted, who: q.who, text: q.text } } : {}) };
    });
  }

  /** When the chat last had something to show (M29.3, the list row's time): its latest turn, notice or link card; null when it has none. */
  lastAt(): number | null {
    return this.sql
      .exec<{ at: number | null }>("SELECT MAX(at) AS at FROM (SELECT COALESCE(ended_at, started_at) AS at FROM turns UNION ALL SELECT at FROM notices UNION ALL SELECT at FROM links)")
      .one().at ?? null;
  }

  /** Every turn that ended failed, with its code and reason (M17.1): a history entry of its own. */
  failedTurns(): FailedTurn[] {
    return this.sql
      .exec<{ id: string; code: string | null; reason: string | null; at: number }>("SELECT id, code, reason, COALESCE(ended_at, started_at) AS at FROM turns WHERE status = 'failed' ORDER BY at, rowid")
      .toArray()
      .map((r) => ({ turnId: r.id, code: r.code ?? "TURN_FAILED", reason: r.reason ?? "", at: r.at }));
  }

  /** The text of the person's latest own typed message (never a note, a notice or a model's words), or undefined. */
  latestTypedText(): string | undefined {
    return this.latestTyped()?.text;
  }

  /** The person's latest own typed message with the turn it began, so a once-per-message allowance can be kept against it. */
  latestTyped(): { turnId: string; text: string } | undefined {
    const row = this.sql
      .exec<{ turn_id: string; body: string }>("SELECT turn_id, body FROM messages WHERE role = 'user' AND 'typed:' || turn_id IN (SELECT key FROM chat_meta WHERE key LIKE 'typed:%') ORDER BY seq DESC LIMIT 1")
      .toArray()[0];
    if (!row) return undefined;
    const content = (JSON.parse(row.body) as { content?: unknown }).content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join(" ") : "";
    // A reply's quote is not the person's words (M29.4): a quoted agent message never counts as what they typed.
    const id = this.meta(`typed:${row.turn_id}`);
    return { turnId: row.turn_id, text: this.actions.shown(id === TYPED_WITHOUT_ID ? undefined : id, text) };
  }

  /** The live transcript: the compaction summary (if any) and every message not compacted away. */
  transcript(): Array<{ seq: number; message: Message }> {
    return this.sql
      .exec<{ seq: number; body: string }>("SELECT seq, body FROM messages WHERE compacted = 0 ORDER BY seq")
      .toArray()
      .map((r) => ({ seq: r.seq, message: JSON.parse(r.body) as Message }));
  }

  /** Marks messages before `seq` compacted, records the summary that replaces them, and the compaction's row. */
  compactBefore(seq: number, summary: string, r: { turnId: string; checkpointSeq: number; tokensBefore: number; at: number; trigger: CompactionTrigger }): CompactionRecord {
    this.sql.exec("UPDATE messages SET compacted = 1 WHERE seq < ?", seq);
    this.setMeta("summary", summary);
    const id = this.sql.exec<{ id: number }>("INSERT INTO compactions (turn_id, checkpoint_seq, first_kept_seq, tokens_before, trigger, at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", r.turnId, r.checkpointSeq, seq, r.tokensBefore, r.trigger, r.at).one().id;
    return this.compactions().find((c) => c.id === id) as CompactionRecord;
  }

  /** A compaction that did not happen: kept as a row with its code and reason, nothing dropped from the transcript. */
  compactionFailed(r: { turnId: string; checkpointSeq: number; tokensBefore: number; at: number; trigger: CompactionTrigger; code: string; reason: string }): CompactionRecord {
    const id = this.sql
      .exec<{ id: number }>("INSERT INTO compactions (turn_id, checkpoint_seq, first_kept_seq, tokens_before, trigger, at, status, code, reason) VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?) RETURNING id", r.turnId, r.checkpointSeq, r.checkpointSeq, r.tokensBefore, r.trigger, r.at, r.code, r.reason)
      .one().id;
    return this.compactions().find((c) => c.id === id) as CompactionRecord;
  }

  /** The chat's compactions, oldest first. */
  compactions(): CompactionRecord[] {
    type Row = { id: number; turn_id: string; checkpoint_seq: number; first_kept_seq: number; tokens_before: number; tokens_after: number | null; trigger: CompactionTrigger; at: number; status: "done" | "failed"; code: string | null; reason: string | null };
    return this.sql
      .exec<Row>("SELECT * FROM compactions ORDER BY id")
      .toArray()
      .map((r) => ({ id: r.id, turnId: r.turn_id, checkpointSeq: r.checkpoint_seq, firstKeptSeq: r.first_kept_seq, tokensBefore: r.tokens_before, tokensAfter: r.tokens_after, trigger: r.trigger, at: r.at, status: r.status, code: r.code, reason: r.reason }));
  }

  startTurn(id: string, person: string, at: number): void {
    this.sql.exec("INSERT INTO turns (id, person, status, started_at) VALUES (?, ?, 'running', ?)", id, person, at);
  }

  runningTurn(): TurnRow | undefined {
    return this.sql.exec<TurnRow>("SELECT * FROM turns WHERE status = 'running' ORDER BY started_at LIMIT 1").toArray()[0];
  }

  /** The turn still running, as the page is told it (M18.1). */
  running(): { turn: string; since: number } | null {
    const t = this.runningTurn();
    return t ? { turn: t.id, since: t.started_at } : null;
  }

  turn(id: string): TurnRow | undefined {
    return this.sql.exec<TurnRow>("SELECT * FROM turns WHERE id = ?", id).toArray()[0];
  }

  turns(): TurnRow[] {
    return this.sql.exec<TurnRow>("SELECT * FROM turns ORDER BY started_at").toArray();
  }

  /** A finished step's input tokens; the first step after a compaction in this turn is that compaction's tokens after. */
  recordStep(id: string, inputTokens: number): void {
    this.sql.exec("UPDATE turns SET steps = steps + 1, input_tokens = ? WHERE id = ?", inputTokens, id);
    this.sql.exec("UPDATE compactions SET tokens_after = ? WHERE turn_id = ? AND tokens_after IS NULL AND status = 'done'", inputTokens, id);
  }

  /** `reason` is a failure's detail, kept beside its code so history can say what happened. */
  endTurn(id: string, status: "done" | "failed" | "stopped", code: string | null, at: number, reason: string | null = null): void {
    this.sql.exec("UPDATE turns SET status = ?, code = ?, reason = ?, ended_at = ? WHERE id = ? AND status = 'running'", status, code, reason, at, id);
  }

  /** Input tokens of the latest finished step, for the compaction check. */
  lastInputTokens(): number {
    return this.sql.exec<{ t: number }>("SELECT input_tokens AS t FROM turns WHERE steps > 0 ORDER BY started_at DESC LIMIT 1").toArray()[0]?.t ?? 0;
  }

  queue(turnId: string, effect: Effect): void {
    this.sql.exec("INSERT INTO outbox (id, turn_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING", effect.id, turnId, JSON.stringify(effect));
  }

  undelivered(): OutboxRow[] {
    return this.sql.exec<OutboxRow>("SELECT * FROM outbox WHERE delivered_at IS NULL ORDER BY rowid").toArray();
  }

  /** The outbox rows a turn committed, oldest first (a stopped turn lists them, M24.2). */
  committed(turnId: string): OutboxRow[] {
    return this.sql.exec<OutboxRow>("SELECT * FROM outbox WHERE turn_id = ? ORDER BY rowid", turnId).toArray();
  }

  markDelivered(id: string, at: number): void {
    this.sql.exec("UPDATE outbox SET delivered_at = ? WHERE id = ?", at, id);
  }
}
