// The person's delivery outbox (M14.1), in the `Person` object's SQLite: every item for the person goes
// through here once, keyed on its id, so a redelivery after an unknown outcome shows nothing twice (B17).
// Pacing decides when (`pacing.ts`); the channels are the chat, always, as the record the next turn
// sees; Web Push to the person's subscriptions only when none of their chats has a client connected;
// and mail to the person's own address only when no client is connected and no push arrived. Feedback
// on an item (accept, edit, reject, stop) is a content-free journal row in the Ledger first; a reject is
// a one-time dismissal that leaves the category alone, a stop is a stated preference that suppresses it.
// Each item keeps its attempts, its next attempt and its disposition (Muse spec §14.4, §16.3): a push or
// a mail that failed on a transient code is retried once at its next attempt, and the item settles as
// `delivered` or `failed`; `null` means not settled yet.
import type { NotifyResult } from "../jobs/engine.ts";
import type { JournalRow } from "../grants/journal.ts";
import type { DeliveryCounts } from "../ledger/rollup.ts";
import { validZone } from "../jobs/schedule.ts";
import { decide, type ItemKind, type PacingState } from "./pacing.ts";
import { checkEndpoint, checkSubscription, encryptPayload, type PushSubscription } from "./webpush.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, last_status INTEGER, last_at INTEGER);
CREATE TABLE IF NOT EXISTS delivery_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, chat TEXT, source TEXT NOT NULL, text TEXT NOT NULL, urgent INTEGER NOT NULL, state TEXT NOT NULL, hold_until INTEGER, code TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER, channels TEXT NOT NULL DEFAULT '[]', feedback TEXT);
CREATE TABLE IF NOT EXISTS delivery_prefs (category TEXT PRIMARY KEY, stance TEXT NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_dismissals (item_id TEXT PRIMARY KEY, category TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_state (id INTEGER PRIMARY KEY CHECK (id = 1), zone TEXT NOT NULL, last_activity_at INTEGER, last_proactive_at INTEGER, mail INTEGER NOT NULL);
`;

/** Item ids fit a journal row's run id and subject reference, so feedback on one is a valid row. */
export const ITEM_ID = /^[A-Za-z0-9:._@-]{1,100}$/;
export const CATEGORY = /^[a-z][a-z0-9_-]*(:[A-Za-z0-9._@/-]{1,100})?$/;
export const VERDICTS = ["accept", "edit", "reject", "stop"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const TEXT_MAX = 16_000;
/** A push lives this long at the push service when the device is away. */
export const PUSH_TTL_S = 86_400;
/** When a channel's one retry is due after a transient failure. */
export const DELIVERY_RETRY_MS = 5 * 60_000;
/** The failures worth one retry: the push service unreachable, rate limiting or failing; mail's send failing. */
export const RETRY_CODES = /^(PUSH_UNREACHABLE|PUSH_HTTP_429|PUSH_HTTP_5\d\d|MAIL_SEND_FAILED|MAIL_FAILED)$/;
export const COLUMNS: Array<[string, string]> = [["attempts", "INTEGER NOT NULL DEFAULT 0"], ["next_attempt", "INTEGER"], ["disposition", "TEXT"], ["retried", "TEXT NOT NULL DEFAULT '[]'"]];

export interface DeliveryInput {
  id: string;
  kind: ItemKind;
  category: string;
  /** The chat a requested result belongs in; an item without one, or whose chat is archived or gone, goes to the person's main chat. */
  chat?: string;
  source: string;
  text: string;
  urgent?: boolean;
}

export type ItemState = "pending" | "held" | "delivered" | "suppressed" | "failed";
export type Channel = "chat" | "push" | "mail";
export type Disposition = "delivered" | "failed" | null;
export type DeliveryResult = { ok: true; id: string; state: ItemState; duplicate: boolean; code: string | null; channels: Channel[] } | Refusal;
type Refusal = { ok: false; code: string; reason: string };

export interface DeliveryDeps {
  person: string;
  now: () => number;
  /** Whether any chat of the person's has one of their clients connected right now. */
  connected: () => Promise<boolean>;
  notify: (chatId: string, n: { id: string; source: string; text: string; person: string }) => Promise<NotifyResult>;
  /** The chat an item lands in (M14.2): the one it names while live and fit for it, else the person's main chat. */
  target: (chat: string | null, kind: ItemKind) => Promise<{ ok: true; chatId: string } | { ok: false; code: string }>;
  /** The `Vault`'s VAPID authorization for one endpoint. */
  authorize: (endpoint: string) => Promise<{ ok: true; header: string } | Refusal>;
  /** The POST to the push service. */
  post: (endpoint: string, init: { headers: Record<string, string>; body: Uint8Array }) => Promise<{ status: number }>;
  /** Mail to the person's own address from the given chat. */
  mail: (chatId: string, subject: string, text: string) => Promise<{ ok: true } | Refusal>;
  journal: (row: JournalRow) => Promise<{ ok: true; duplicate: boolean } | Refusal>;
  /** Asks for `flush` at the given time. */
  arm: (at: number) => Promise<void>;
}

type Raw = Record<string, unknown>;
const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });
const notOwner = () => refuse("DELIVERY_NOT_OWNER", "only the person changes their own delivery");

export interface ItemView {
  id: string;
  kind: ItemKind;
  category: string;
  chat: string | null;
  source: string;
  text: string;
  urgent: boolean;
  state: ItemState;
  holdUntil: number | null;
  code: string | null;
  createdAt: number;
  deliveredAt: number | null;
  channels: Channel[];
  feedback: Verdict | null;
  attempts: number;
  nextAttempt: number | null;
  disposition: Disposition;
  /** Channels whose one retry is spent. */
  retried: Channel[];
}

const toItem = (r: Raw): ItemView => ({
  id: String(r.id), kind: r.kind as ItemKind, category: String(r.category), chat: (r.chat as string | null) ?? null, source: String(r.source), text: String(r.text),
  urgent: r.urgent === 1, state: r.state as ItemState, holdUntil: (r.hold_until as number | null) ?? null, code: (r.code as string | null) ?? null,
  createdAt: Number(r.created_at), deliveredAt: (r.delivered_at as number | null) ?? null, channels: JSON.parse(String(r.channels)) as Channel[], feedback: (r.feedback as Verdict | null) ?? null,
  attempts: Number(r.attempts ?? 0), nextAttempt: (r.next_attempt as number | null) ?? null, disposition: (r.disposition as Disposition) ?? null, retried: JSON.parse(String(r.retried ?? "[]")) as Channel[],
});

export class PersonDelivery {
  private readonly storage: Pick<DurableObjectStorage, "sql">;
  private readonly d: DeliveryDeps;

  constructor(storage: Pick<DurableObjectStorage, "sql">, deps: DeliveryDeps) {
    this.storage = storage;
    this.d = deps;
  }

  private sql(query: string, ...bindings: unknown[]): Raw[] {
    return this.storage.sql.exec(query, ...bindings).toArray() as Raw[];
  }

  private state(): PacingState & { mail: boolean } {
    const s = this.sql("SELECT * FROM delivery_state WHERE id = 1")[0] as Raw;
    const stopped = new Set(this.sql("SELECT category FROM delivery_prefs WHERE stance = 'stop'").map((r) => String(r.category)));
    return { zone: String(s.zone), lastActivityAt: (s.last_activity_at as number | null) ?? null, lastProactiveAt: (s.last_proactive_at as number | null) ?? null, stopped, mail: s.mail === 1 };
  }

  private item(id: string): ItemView | null {
    const r = this.sql("SELECT * FROM delivery_items WHERE id = ?", id)[0];
    return r ? toItem(r) : null;
  }

  private result(i: ItemView, duplicate: boolean): DeliveryResult {
    return { ok: true, id: i.id, state: i.state, duplicate, code: i.code, channels: i.channels };
  }

  /** One item for the person, once per id; a requested result is delivered before this returns. */
  async deliver(input: DeliveryInput): Promise<DeliveryResult> {
    if (!ITEM_ID.test(String(input.id))) return refuse("DELIVERY_ITEM_INVALID", "an item id is 1-100 characters of letters, digits and :._@-");
    if (input.kind !== "requested" && input.kind !== "proactive") return refuse("DELIVERY_ITEM_INVALID", "kind is requested or proactive");
    if (!CATEGORY.test(String(input.category))) return refuse("DELIVERY_ITEM_INVALID", "a category is a lowercase name, optionally with :<id>");
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > TEXT_MAX) return refuse("DELIVERY_ITEM_INVALID", `text is 1-${TEXT_MAX} characters`);
    if (input.kind === "requested" && !input.chat) return refuse("DELIVERY_ITEM_INVALID", "a requested result names the chat it belongs in");
    const seen = this.item(input.id);
    // A pending row is an unknown outcome: deliver it again, which the chat keeps once per id.
    // A failed requested result is retried by its sender (a job's outbox backs off), so it goes again too.
    if (seen && seen.state !== "pending" && seen.state !== "failed") return this.result(seen, true);
    const now = this.d.now();
    if (!seen) {
      this.sql(
        "INSERT INTO delivery_items (id, kind, category, chat, source, text, urgent, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        input.id, input.kind, input.category, input.chat ?? null, input.source, input.text, input.urgent ? 1 : 0, now,
      );
    }
    const item = this.item(input.id) as ItemView;
    const verdict = decide(item, this.state(), now);
    if (verdict.action === "suppress") {
      this.sql("UPDATE delivery_items SET state = 'suppressed', code = ? WHERE id = ?", verdict.code, item.id);
    } else if (verdict.action === "hold") {
      this.sql("UPDATE delivery_items SET state = 'held', hold_until = ?, code = ? WHERE id = ?", verdict.until, verdict.code, item.id);
      await this.armNext();
    } else {
      if (item.kind === "proactive") this.suppressStopped();
      await this.send(item.kind === "proactive" ? [item, ...this.held().filter((h) => h.id !== item.id)] : [item]);
    }
    return this.result(this.item(input.id) as ItemView, false);
  }

  private held(): ItemView[] {
    return this.sql("SELECT * FROM delivery_items WHERE state = 'held' ORDER BY created_at, id").map(toItem);
  }

  /** A held item whose category the person has since stopped is suppressed, never sent. */
  private suppressStopped(): void {
    const stopped = this.state().stopped;
    for (const h of this.held()) if (stopped.has(h.category)) this.sql("UPDATE delivery_items SET state = 'suppressed', code = 'DELIVERY_STOPPED', hold_until = NULL WHERE id = ?", h.id);
  }

  /** The alarm: due retries go once more; held proactive items are decided again, and when one may go, every held item goes with it. */
  async flush(): Promise<void> {
    const now = this.d.now();
    await this.retryDue(now);
    this.suppressStopped();
    const st = this.state();
    const held = this.held();
    const first = held[0];
    if (first) {
      const verdict = decide({ ...first, urgent: false }, st, now);
      if (verdict.action === "deliver") await this.send(held);
      else if (verdict.action === "hold") for (const h of held) this.sql("UPDATE delivery_items SET hold_until = ?, code = ? WHERE id = ?", verdict.until, verdict.code, h.id);
    }
    await this.armNext();
  }

  /** One flush serves both held items and retries, so it is armed for whichever is due first. */
  private async armNext(): Promise<void> {
    const r = this.sql(
      "SELECT MIN(t) AS at FROM (SELECT hold_until AS t FROM delivery_items WHERE state = 'held' UNION ALL SELECT next_attempt AS t FROM delivery_items WHERE disposition IS NULL AND next_attempt IS NOT NULL)",
    )[0];
    if (r?.at !== null && r?.at !== undefined) await this.d.arm(Number(r.at));
  }

  /** Items whose one retry is due: their chat already holds them, so only the failed channel goes again. */
  private async retryDue(now: number): Promise<void> {
    const due = this.sql("SELECT * FROM delivery_items WHERE state = 'delivered' AND disposition IS NULL AND next_attempt IS NOT NULL AND next_attempt <= ? ORDER BY created_at, id", now).map(toItem);
    // The channel owed a retry is the last one that failed; one owed mail has spent push's retry already.
    for (const owed of ["push", "mail"] as const) {
      const group = due.filter((i) => i.retried.at(-1) === owed);
      if (!group.length) continue;
      const r = await this.reach(group.map((i) => ({ ...i, chat: i.chat as string })), [...new Set(group.flatMap((i) => i.retried))], owed === "mail");
      for (const i of group) this.settle(i, r, now, [...new Set([...i.channels, ...r.via])]);
    }
  }

  /**
   * The person outside the app: a push, else their own mail. A channel that fails on a transient code
   * and has not been retried yet asks for its one retry instead of falling through.
   */
  private async reach(shown: Array<ItemView & { chat: string }>, retried: Channel[], mailOnly = false): Promise<{ via: Channel[]; code: string | null; retry: Channel | null; settled: Disposition }> {
    if (await this.d.connected().catch(() => false)) return { via: [], code: null, retry: null, settled: "delivered" };
    const pushed = mailOnly ? { delivered: false, code: "PUSH_RETRY_SPENT" } : await this.push(shown);
    if (pushed.delivered) return { via: ["push"], code: null, retry: null, settled: "delivered" };
    if (pushed.code && RETRY_CODES.test(pushed.code) && !retried.includes("push")) return { via: [], code: pushed.code, retry: "push", settled: null };
    // The person's own mail is not mailed back to them; it waits in the chat. With no push subscription
    // and mail off, nothing out of band applies and the chat is where the item is delivered.
    if (!this.state().mail || shown.every((x) => x.category === "mail")) return { via: [], code: pushed.code, retry: null, settled: pushed.code === "PUSH_NO_SUBSCRIPTION" ? "delivered" : "failed" };
    const first = shown[0] as ItemView & { chat: string };
    const m = await this.d.mail(first.chat, `qyvr: ${shown.length === 1 ? first.source : `${shown.length} updates`}`, shown.map((s) => s.text).join("\n\n---\n\n")).catch((e: unknown): Refusal => refuse("MAIL_FAILED", String(e)));
    if (m.ok) return { via: ["mail"], code: pushed.code, retry: null, settled: "delivered" };
    if (RETRY_CODES.test(m.code) && !retried.includes("mail")) return { via: [], code: m.code, retry: "mail", settled: null };
    return { via: [], code: m.code, retry: null, settled: "failed" };
  }

  /** Writes one attempt's outcome: its disposition, or its next attempt when a channel's retry is owed. */
  private settle(i: ItemView, r: { code: string | null; retry: Channel | null; settled: Disposition }, now: number, channels: Channel[]): void {
    const retried = r.retry ? [...new Set([...i.retried, r.retry])] : i.retried;
    this.sql(
      "UPDATE delivery_items SET attempts = attempts + 1, next_attempt = ?, disposition = ?, retried = ?, code = ?, channels = ? WHERE id = ?",
      r.retry ? now + DELIVERY_RETRY_MS : null, r.settled, JSON.stringify(retried), r.code, JSON.stringify(channels), i.id,
    );
  }

  /** Delivers items now as one delivery: each into its chat, then one push or one mail for them all. */
  private async send(items: ItemView[]): Promise<void> {
    const now = this.d.now();
    const shown: Array<ItemView & { chat: string }> = [];
    for (const it of items) {
      const to = await this.d.target(it.chat, it.kind);
      if (!to.ok) {
        this.sql("UPDATE delivery_items SET state = 'failed', code = ?, attempts = attempts + 1, disposition = 'failed' WHERE id = ?", to.code, it.id);
        continue;
      }
      const chat = to.chatId;
      const r = await this.d.notify(chat, { id: it.id, source: it.source, text: it.text, person: this.d.person }).catch((e: unknown): NotifyResult => ({ ok: false, code: "NOTIFY_FAILED", reason: String(e) }));
      if (!r.ok) {
        this.sql("UPDATE delivery_items SET state = 'failed', code = ?, attempts = attempts + 1, disposition = 'failed' WHERE id = ?", r.code, it.id);
        continue;
      }
      shown.push({ ...it, chat });
    }
    if (!shown.length) return;
    const r = await this.reach(shown, []);
    for (const it of shown) {
      this.sql("UPDATE delivery_items SET state = 'delivered', delivered_at = ?, hold_until = NULL, chat = ? WHERE id = ?", now, it.chat, it.id);
      this.settle(it, r, now, ["chat", ...r.via]);
    }
    if (r.retry) await this.armNext();
    if (shown.some((s) => s.kind === "proactive")) this.sql("UPDATE delivery_state SET last_proactive_at = ? WHERE id = 1", now);
  }

  /** One push to each subscription; a gone subscription (404, 410) is removed. Delivered if any took it. */
  private async push(items: Array<ItemView & { chat: string }>): Promise<{ delivered: boolean; code: string | null }> {
    const subs = this.sql("SELECT * FROM push_subscriptions ORDER BY created_at").map((r) => ({ endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }) satisfies PushSubscription);
    if (!subs.length) return { delivered: false, code: "PUSH_NO_SUBSCRIPTION" };
    const first = items[0] as ItemView & { chat: string };
    const payload = new TextEncoder().encode(JSON.stringify({
      title: items.length === 1 ? first.source : `${items.length} updates`,
      body: first.text.split("\n")[0]?.slice(0, 160) ?? "",
      items: items.map((i) => i.id),
      url: first.chat ? `/?chat=${encodeURIComponent(first.chat)}` : "/",
    }));
    let delivered = false;
    let code: string | null = null;
    for (const sub of subs) {
      // The stored row was checked when it was written; the policy is checked again on every use.
      const policy = checkEndpoint(sub.endpoint);
      if (!policy.ok) {
        code = policy.code;
        continue;
      }
      const auth = await this.d.authorize(sub.endpoint);
      if (!auth.ok) {
        code = auth.code;
        continue;
      }
      const body = await encryptPayload(sub, payload);
      if (!body.ok) {
        code = body.code;
        continue;
      }
      const headers = { authorization: auth.header, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(PUSH_TTL_S), urgency: items.some((i) => i.urgent) ? "high" : "normal" };
      const r = await this.d.post(sub.endpoint, { headers, body: body.body }).catch(() => ({ status: 0 }));
      this.sql("UPDATE push_subscriptions SET last_status = ?, last_at = ? WHERE endpoint = ?", r.status, this.d.now(), sub.endpoint);
      if (r.status === 404 || r.status === 410) this.sql("DELETE FROM push_subscriptions WHERE endpoint = ?", sub.endpoint);
      if (r.status >= 200 && r.status < 300) delivered = true;
      else code = r.status === 0 ? "PUSH_UNREACHABLE" : `PUSH_HTTP_${r.status}`;
    }
    return { delivered, code: delivered ? null : code };
  }

  /**
   * A test notification (M15.5): one push to the person's own subscribed devices, now, past pacing and
   * the connected check. It leaves a delivery row in category `test` (kept out of the counts) and
   * nothing in a chat or the journal; a push that did not reach a device is refused with its code.
   */
  async testPush(by: string): Promise<{ ok: true; id: string } | Refusal> {
    if (by !== this.d.person) return notOwner();
    const now = this.d.now();
    const id = `test:${crypto.randomUUID()}`;
    this.sql("INSERT INTO delivery_items (id, kind, category, chat, source, text, urgent, state, created_at) VALUES (?, 'requested', 'test', NULL, 'qyvr', 'Test notification: your agent can reach this device.', 0, 'pending', ?)", id, now);
    const r = await this.push([this.item(id) as ItemView & { chat: string }]);
    this.sql(
      "UPDATE delivery_items SET state = 'delivered', delivered_at = ?, attempts = 1, disposition = ?, code = ?, channels = ? WHERE id = ?",
      now, r.delivered ? "delivered" : "failed", r.code, JSON.stringify(r.delivered ? ["push"] : []), id,
    );
    return r.delivered ? { ok: true, id } : refuse(r.code ?? "PUSH_FAILED", r.code === "PUSH_NO_SUBSCRIPTION" ? "no device of yours has notifications turned on" : "the push service did not take the notification");
  }

  /** The person wrote in a chat: the quiet stretch starts again. */
  activity(): void {
    this.sql("UPDATE delivery_state SET last_activity_at = ? WHERE id = 1", this.d.now());
  }

  subscribe(by: string, input: unknown): { ok: true; endpoint: string } | Refusal {
    if (by !== this.d.person) return notOwner();
    const c = checkSubscription(input);
    if (!c.ok) return c;
    this.sql(
      "INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
      c.sub.endpoint, c.sub.p256dh, c.sub.auth, this.d.now(),
    );
    return { ok: true, endpoint: c.sub.endpoint };
  }

  unsubscribe(by: string, endpoint: unknown): { ok: true; removed: boolean } | Refusal {
    if (by !== this.d.person) return notOwner();
    const before = this.sql("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?", String(endpoint ?? "")).length;
    this.sql("DELETE FROM push_subscriptions WHERE endpoint = ?", String(endpoint ?? ""));
    return { ok: true, removed: before > 0 };
  }

  /**
   * The person's verdict on a delivered item. The journal row goes first and carries only ids and a
   * code; if the Ledger refuses it nothing changes here. A reject is remembered as a one-time dismissal;
   * a stop is a stated preference on the item's category.
   */
  async feedback(by: string, id: unknown, verdict: unknown): Promise<{ ok: true; verdict: Verdict; duplicate: boolean } | Refusal> {
    if (by !== this.d.person) return notOwner();
    if (!VERDICTS.includes(verdict as Verdict)) return refuse("DELIVERY_FEEDBACK_INVALID", `verdict is one of ${VERDICTS.join(", ")}`);
    const item = typeof id === "string" && ITEM_ID.test(id) ? this.item(id) : null;
    if (!item) return refuse("DELIVERY_ITEM_UNKNOWN", "no such item for this person");
    if (item.state !== "delivered") return refuse("DELIVERY_NOT_DELIVERED", `the item is ${item.state}`);
    const v = verdict as Verdict;
    const now = this.d.now();
    const row: JournalRow = {
      id: `feedback:${item.id}:${v}`, at: now, actor: `person:${by}`, principal: by, actionKind: "delivery.feedback", subjectRef: `personal;resource:delivery/${item.id}`,
      counterpart: "own-agent", origin: by, hops: 0, decision: "auto", grantId: null, outcome: `FEEDBACK_${v.toUpperCase()}`, runId: item.id, tokens: 0,
    };
    const j = await this.d.journal(row);
    if (!j.ok) return j;
    this.sql("UPDATE delivery_items SET feedback = ? WHERE id = ?", v, item.id);
    if (v === "reject") this.sql("INSERT INTO delivery_dismissals (item_id, category, at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO NOTHING", item.id, item.category, now);
    if (v === "stop") this.setStop(item.category, "feedback", now);
    return { ok: true, verdict: v, duplicate: j.duplicate };
  }

  private setStop(category: string, via: string, at: number) {
    this.sql("INSERT INTO delivery_prefs (category, stance, via, at) VALUES (?, 'stop', ?, ?) ON CONFLICT(category) DO UPDATE SET stance = 'stop', via = excluded.via, at = excluded.at", category, via, at);
  }

  /** A preference the person states in settings: stop a category, allow it again, their zone, mail on or off. */
  preferences(by: string, input: { stop?: unknown; allow?: unknown; zone?: unknown; mail?: unknown }): { ok: true } | Refusal {
    if (by !== this.d.person) return notOwner();
    const now = this.d.now();
    for (const c of [input.stop, input.allow]) if (c !== undefined && !CATEGORY.test(String(c))) return refuse("DELIVERY_CATEGORY_INVALID", "a category is a lowercase name, optionally with :<id>");
    if (input.zone !== undefined && !validZone(input.zone)) return refuse("DELIVERY_ZONE_INVALID", "an IANA zone such as Europe/Paris, or UTC");
    if (input.mail !== undefined && typeof input.mail !== "boolean") return refuse("DELIVERY_MAIL_INVALID", "mail is true or false");
    if (input.stop !== undefined) this.setStop(String(input.stop), "settings", now);
    if (input.allow !== undefined) this.sql("DELETE FROM delivery_prefs WHERE category = ?", String(input.allow));
    if (input.zone !== undefined) this.sql("UPDATE delivery_state SET zone = ? WHERE id = 1", input.zone);
    if (input.mail !== undefined) this.sql("UPDATE delivery_state SET mail = ? WHERE id = 1", input.mail ? 1 : 0);
    return { ok: true };
  }

  /**
   * How the person's items created in `[from, to)` ended (M15.3), as counts with no item, text or
   * category: for the dashboards and the sweeper's rollup, which see numbers and nothing else.
   */
  counts(from: number, to: number): DeliveryCounts {
    const items = this.sql("SELECT disposition, feedback, retried FROM delivery_items WHERE created_at >= ? AND created_at < ? AND category <> 'test'", from, to);
    const n = (f: (r: Raw) => boolean) => items.filter(f).length;
    return {
      person: this.d.person, items: items.length,
      delivered: n((r) => r.disposition === "delivered"), failed: n((r) => r.disposition === "failed"), open: n((r) => r.disposition == null),
      retried: n((r) => String(r.retried ?? "[]") !== "[]"),
      accepted: n((r) => r.feedback === "accept"), edited: n((r) => r.feedback === "edit"), rejected: n((r) => r.feedback === "reject"), stopped: n((r) => r.feedback === "stop"),
    };
  }

  /** The person's items, preferences, dismissals and subscriptions (endpoint hosts only), to the person alone. */
  view(by: string) {
    if (by !== this.d.person) return notOwner();
    const s = this.state();
    return {
      ok: true as const,
      items: this.sql("SELECT * FROM delivery_items ORDER BY created_at DESC, id LIMIT 200").map(toItem),
      stopped: [...s.stopped].sort(),
      dismissals: this.sql("SELECT item_id, category, at FROM delivery_dismissals ORDER BY at").map((r) => ({ item: String(r.item_id), category: String(r.category), at: Number(r.at) })),
      subscriptions: this.sql("SELECT endpoint, created_at, last_status FROM push_subscriptions ORDER BY created_at").map((r) => ({ endpoint: String(r.endpoint), host: new URL(String(r.endpoint)).hostname, createdAt: Number(r.created_at), lastStatus: (r.last_status as number | null) ?? null })),
      zone: s.zone,
      mail: s.mail,
    };
  }
}

/** A delivery as a chat notice's result, for senders that speak `NotifyResult` (jobs, mail). */
export function asNotify(r: DeliveryResult): NotifyResult {
  if (!r.ok) return r;
  return r.state === "failed" ? { ok: false, code: r.code ?? "DELIVERY_FAILED", reason: "the item did not reach its chat" } : { ok: true, duplicate: r.duplicate };
}

export type DeliveryCall =
  | { op: "subscribe"; subscription: unknown }
  | { op: "unsubscribe"; endpoint: unknown }
  | { op: "feedback"; id: unknown; verdict: unknown }
  | { op: "preferences"; stop?: unknown; allow?: unknown; zone?: unknown; mail?: unknown }
  | { op: "test_push" }
  | { op: "view" };

/** The person's own calls from the app's routes, each checked against the object's person. */
export async function runCall(d: PersonDelivery, by: string, call: DeliveryCall) {
  switch (call.op) {
    case "subscribe":
      return d.subscribe(by, call.subscription);
    case "unsubscribe":
      return d.unsubscribe(by, call.endpoint);
    case "feedback":
      return d.feedback(by, call.id, call.verdict);
    case "preferences":
      return d.preferences(by, call);
    case "test_push":
      return d.testPush(by);
    case "view":
      return d.view(by);
  }
}
