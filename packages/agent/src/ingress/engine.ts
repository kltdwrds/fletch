// The Ingress engine (M6.1, AD-4): one push source per object, named by a random source id. A
// webhook reaches it on the tenant's hostname at `/hooks/<id>` with a Standard Webhooks signature;
// a socket source is one outbound WebSocket this object holds and reconnects from its alarm. Either
// way an accepted event is claimed under a lease, handed to each subscribed job as one gate
// evaluation (the `Job` keys it on the event id), and marked done:
//
//   verify (webhook) -> claim (fresh | reclaimed after a dead lease | in flight: retry later | done: no-op)
//   -> dry run: record what would be evaluated -> otherwise each job's `event()` -> done
//
// A lease that ends unfinished (the instance died mid-delivery) is re-delivered by the alarm armed
// for its end, so a socket event, which no sender retries, is not lost either.
//
// Nothing an event carries changes the source, its jobs or a grant: it is data for a gate.
import { JOB_ID } from "../jobs/body.ts";
import type { EventOutcome } from "../jobs/engine.ts";
import type { JobEvent } from "../jobs/events.ts";
import { verifyWebhook } from "./signature.ts";
import { type DeliveryRow, type EventRow, IngressStore, type SocketRow, type SourceKind, type SourceRow } from "./store.ts";

/** A delivery's lease: a sender's retry inside it waits; after it, the event is delivered again. */
export const EVENT_LEASE_MS = 60_000;
export const MAX_BODY_BYTES = 256 * 1024;
/** Reconnect backoff: 1 s doubling to 5 minutes. */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 5 * 60_000;
/** While connected the alarm checks the socket is still held by this instance (an eviction drops it). */
export const HEARTBEAT_MS = 60_000;

/** The part of a WebSocket the source uses; production's is the platform's, tests' a fake server's end. */
export interface SourceSocket {
  addEventListener(type: "message" | "close" | "error", listener: (ev: { data?: unknown; code?: number; reason?: string }) => void): void;
  close(code?: number, reason?: string): void;
}

export interface IngressDeps {
  now(): number;
  /** The owner's job by id; `event` is that `Job`'s own method, which decides ownership again. */
  job(owner: string, jobId: string): { event(e: JobEvent): Promise<EventOutcome> };
  /** Opens the outbound socket; throws when the server refuses. */
  connect(url: string): Promise<SourceSocket>;
  /** Whether the owner's host registry lists this host (the Vault's rules for them); a socket source opens only to one it lists (M25.5). */
  listed(owner: string, host: string): Promise<boolean>;
  newSecret(): string;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  log(event: Record<string, unknown>): void;
}

export type IngressRefusal = { ok: false; code: string; reason: string };
export type Created = { ok: true; id: string; kind: SourceKind; secret?: string } | IngressRefusal;
export interface Answer {
  status: number;
  code: string;
  reason?: string;
}

const SOURCE_ID = /^[0-9a-f]{32}$/;
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_JOBS = 8;

/** The host of a socket source's address: wss, and no userinfo or port, so the registry's host is the host dialled. */
function socketHost(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("wss://")) return null;
  try {
    const u = new URL(url);
    return u.username || u.password || u.port ? null : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class IngressEngine {
  readonly store: IngressStore;
  private readonly deps: IngressDeps;
  /** The socket this instance holds; an eviction loses it, which the heartbeat alarm notices. */
  private socket: SourceSocket | null = null;

  constructor(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, deps: IngressDeps) {
    this.store = new IngressStore(storage);
    this.deps = deps;
  }

  /** The source id, for log lines. */
  private get name(): string {
    return this.store.source()?.id ?? "unknown";
  }

  /** Creates this object's source for `owner` under `id`, the object's name; the webhook secret is returned here once and never again. */
  async create(a: { id: string; owner: string; kind: SourceKind; jobs: string[]; dryRun?: boolean; url?: string }): Promise<Created> {
    if (!SOURCE_ID.test(a.id)) return { ok: false, code: "INGRESS_ID_INVALID", reason: "a source id is 32 hex characters" };
    if (this.store.source()) return { ok: false, code: "INGRESS_EXISTS", reason: "this source already exists" };
    if (a.kind !== "webhook" && a.kind !== "socket") return { ok: false, code: "INGRESS_KIND_INVALID", reason: "a source is a webhook or a socket" };
    if (!Array.isArray(a.jobs) || a.jobs.length > MAX_JOBS || !a.jobs.every((j) => typeof j === "string" && JOB_ID.test(j))) {
      return { ok: false, code: "INGRESS_JOBS_INVALID", reason: `jobs are up to ${MAX_JOBS} of the owner's job ids` };
    }
    if (a.kind === "socket") {
      const host = socketHost(a.url);
      if (!host) return { ok: false, code: "INGRESS_URL_INVALID", reason: "a socket source names a wss:// url with no userinfo or port" };
      // The one out-of-egress channel whose address a creator chooses (`egress/outbound.ts`): bounded by the owner's registry.
      if (!(await this.deps.listed(a.owner, host))) return { ok: false, code: "INGRESS_HOST_UNLISTED", reason: `${host} is not a listed host of ${a.owner}'s` };
    }
    const secret = a.kind === "webhook" ? this.deps.newSecret() : null;
    const now = this.deps.now();
    this.store.transaction(() => this.store.putSource({ id: a.id, owner: a.owner, kind: a.kind, secret, url: a.kind === "socket" ? (a.url as string) : null, jobs: [...new Set(a.jobs)], dryRun: a.dryRun === true, createdAt: now }));
    return { ok: true, id: a.id, kind: a.kind, ...(secret ? { secret } : {}) };
  }

  /** The owner's view: the source without its secret, events, deliveries, refusals and the socket. */
  inspect(by: string): { ok: true; source: Omit<SourceRow, "secret">; events: EventRow[]; deliveries: DeliveryRow[]; rejects: ReturnType<IngressStore["rejects"]>; socket: SocketRow } | IngressRefusal {
    const s = this.store.source();
    if (!s) return { ok: false, code: "INGRESS_UNKNOWN", reason: "no such source" };
    if (s.owner !== by) return { ok: false, code: "INGRESS_NOT_OWNER", reason: "only the source's owner sees it" };
    const { secret: _secret, ...source } = s;
    return { ok: true, source, events: this.store.events(), deliveries: this.store.deliveries(), rejects: this.store.rejects(), socket: this.store.socket() };
  }

  async setDryRun(by: string, dryRun: boolean): Promise<{ ok: true } | IngressRefusal> {
    const s = this.store.source();
    if (!s) return { ok: false, code: "INGRESS_UNKNOWN", reason: "no such source" };
    if (s.owner !== by) return { ok: false, code: "INGRESS_NOT_OWNER", reason: "only the source's owner changes it" };
    this.store.transaction(() => this.store.setDryRun(dryRun));
    return { ok: true };
  }

  /** A webhook delivery: refused and logged unless the signature verifies; then accepted once. */
  async webhook(headers: Record<string, string | undefined>, body: string): Promise<Answer> {
    const s = this.store.source();
    if (s?.kind !== "webhook" || !s.secret) return { status: 404, code: "INGRESS_UNKNOWN" };
    const now = this.deps.now();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return this.refuse(413, "HOOK_BODY_TOO_LARGE", `bodies are at most ${MAX_BODY_BYTES} bytes`, now);
    const verdict = await verifyWebhook(s.secret, headers, body, now);
    if (!verdict.ok) return this.refuse(401, verdict.code, verdict.reason, now);
    return this.accept(s, verdict.id, body, "webhook");
  }

  private refuse(status: number, code: string, reason: string, now: number): Answer {
    this.store.transaction(() => this.store.reject(code, reason, now));
    this.deps.log({ event: "ingress.rejected", source: this.name, code });
    return { status, code, reason };
  }

  /** Claims, delivers and finishes one event; every branch answers with a code. */
  private async accept(s: SourceRow, eventId: string, payload: string, via: SourceKind): Promise<Answer> {
    const now = this.deps.now();
    const claim = this.store.transaction(() => this.store.claim(eventId, via, payload, now, EVENT_LEASE_MS));
    if (claim === "done") return { status: 200, code: "INGRESS_DUPLICATE" };
    if (claim === "in_flight") return { status: 409, code: "INGRESS_IN_FLIGHT", reason: "this event is being delivered; retry later" };
    await this.armAlarm();
    if (s.dryRun) {
      this.store.transaction(() => {
        for (const job of s.jobs) this.store.recordDelivery(eventId, job, { dryRun: true, wouldEvaluate: true }, now);
        this.store.finish(eventId, now);
      });
      return { status: 202, code: "INGRESS_DRY_RUN" };
    }
    for (const job of s.jobs) {
      let outcome: EventOutcome;
      try {
        outcome = await this.deps.job(s.owner, job).event({ eventId, source: s.id, owner: s.owner, payload });
      } catch (error) {
        // Left leased: the lease's end, or the sender's retry after it, delivers again; jobs already
        // evaluated answer `duplicate`, so no job evaluates this event twice.
        this.deps.log({ event: "ingress.delivery_failed", source: this.name, job, message: String((error as Error).message ?? error).slice(0, 200) });
        return { status: 503, code: "INGRESS_DELIVERY_FAILED", reason: "a subscribed job could not be reached; retry later" };
      }
      this.store.transaction(() => this.store.recordDelivery(eventId, job, { ...outcome }, this.deps.now()));
    }
    this.store.transaction(() => this.store.finish(eventId, this.deps.now()));
    return { status: 202, code: "INGRESS_ACCEPTED" };
  }

  /** Starts the socket source for its owner; the alarm keeps it connected from then on. */
  async start(by: string): Promise<{ ok: true; socket: SocketRow } | IngressRefusal> {
    const s = this.store.source();
    if (s?.kind !== "socket") return { ok: false, code: "INGRESS_UNKNOWN", reason: "no socket source here" };
    if (s.owner !== by) return { ok: false, code: "INGRESS_NOT_OWNER", reason: "only the source's owner starts it" };
    this.store.transaction(() => this.store.updateSocket({ wanted: 1, attempts: 0 }, this.deps.now()));
    await this.connect(s);
    return { ok: true, socket: this.store.socket() };
  }

  async stop(by: string): Promise<{ ok: true } | IngressRefusal> {
    const s = this.store.source();
    if (s?.kind !== "socket") return { ok: false, code: "INGRESS_UNKNOWN", reason: "no socket source here" };
    if (s.owner !== by) return { ok: false, code: "INGRESS_NOT_OWNER", reason: "only the source's owner stops it" };
    this.store.transaction(() => this.store.updateSocket({ wanted: 0, state: "idle", next_attempt: null }, this.deps.now()));
    const held = this.socket;
    this.socket = null;
    held?.close(1000, "stopped by owner");
    await this.armAlarm();
    return { ok: true };
  }

  /** The one alarm: re-delivers events whose lease ended unfinished, and reconnects a wanted socket this instance does not hold. */
  async alarm(): Promise<void> {
    const s = this.store.source();
    if (!s) return;
    for (const e of this.store.expired(this.deps.now())) await this.accept(s, e.eventId, e.payload, e.via);
    if (s.kind === "socket" && this.store.socket().wanted && !this.socket) await this.connect(s);
    await this.armAlarm();
  }

  private async connect(s: SourceRow): Promise<void> {
    const now = this.deps.now();
    this.store.transaction(() => this.store.updateSocket({ state: "connecting" }, now));
    let socket: SourceSocket;
    try {
      socket = await this.deps.connect(s.url as string);
    } catch (error) {
      await this.dropped(null, "INGRESS_SOCKET_CONNECT_FAILED", String((error as Error).message ?? error));
      return;
    }
    this.socket = socket;
    const at = this.deps.now();
    this.store.transaction(() => {
      const row = this.store.socket();
      this.store.updateSocket({ state: "connected", attempts: 0, next_attempt: null, connects: row.connects + 1, last_code: null }, at);
    });
    socket.addEventListener("message", (ev) => void this.message(s, ev.data));
    socket.addEventListener("close", (ev) => void this.dropped(socket, "INGRESS_SOCKET_CLOSED", `closed with ${ev.code ?? "no code"}`));
    socket.addEventListener("error", () => void this.dropped(socket, "INGRESS_SOCKET_ERROR", "the socket errored"));
    await this.armAlarm();
  }

  /** A lost socket waits out its backoff, then the alarm reconnects; a socket already replaced is ignored. */
  private async dropped(socket: SourceSocket | null, code: string, reason: string): Promise<void> {
    if (socket !== null && socket !== this.socket) return;
    this.socket = null;
    const now = this.deps.now();
    const row = this.store.socket();
    if (!row.wanted) return;
    const attempts = row.attempts + 1;
    const next = now + Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);
    this.store.transaction(() => this.store.updateSocket({ state: "waiting", attempts, next_attempt: next, drops: row.drops + (socket ? 1 : 0), last_code: code }, now));
    this.deps.log({ event: "ingress.socket_down", source: this.name, code, reason: reason.slice(0, 200), retryAt: next });
    await this.armAlarm();
  }

  private async message(s: SourceRow, data: unknown): Promise<void> {
    const now = this.deps.now();
    const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "";
    if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      this.refuse(413, "INGRESS_MESSAGE_INVALID", "a socket message is UTF-8 text within the size limit", now);
      return;
    }
    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
    if (typeof id !== "string" || !EVENT_ID.test(id)) {
      this.refuse(400, "INGRESS_EVENT_ID_MISSING", "a socket message is JSON with a string id", now);
      return;
    }
    await this.accept(s, id, text, "socket");
  }

  /** The earliest of: the socket's reconnect or heartbeat, the end of a held lease. */
  private async armAlarm(): Promise<void> {
    const now = this.deps.now();
    const times: number[] = [];
    const s = this.store.source();
    const sock = this.store.socket();
    if (s?.kind === "socket" && sock.wanted) times.push(this.socket ? now + HEARTBEAT_MS : (sock.nextAttempt ?? now));
    const lease = this.store.nextLeaseEnd();
    if (lease !== null) times.push(lease);
    if (times.length) await this.deps.setAlarm(Math.min(...times));
    else await this.deps.deleteAlarm();
  }
}
