// A hermetic world for push ingress (M6.1): the real `IngressEngine` over the object harness, feeding
// the real `Job` engines of two members (Ada and Bo, each a `jobWorld` on one clock), with a fake
// socket server the source connects to. Tests own the store and the clock: the clock moves only to
// an alarm the object armed, and alarms are fired explicitly. A socket source opens only to a host the
// owner's registry lists (M25.5): by default Ada's lists the stream host the socket tests use, and a
// test may pass the real Vault's `listsHost` instead.
import { type IngressDeps, IngressEngine, type SourceSocket } from "../../../packages/agent/src/ingress/engine.ts";
import { newSecret } from "../../../packages/agent/src/ingress/signature.ts";
import type { JobDefinition } from "../../../packages/agent/src/jobs/body.ts";
import type { EventOutcome } from "../../../packages/agent/src/jobs/engine.ts";
import type { JobEvent } from "../../../packages/agent/src/jobs/events.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { ada, jobWorld, ledgerSpace, T0 } from "./job-world.ts";

export const SOURCE = "0123456789abcdef0123456789abcdef";

/** One end of an in-memory socket; the server end is the test's. */
export class Peer {
  readonly listeners: Record<string, Array<(ev: { data?: unknown; code?: number }) => void>> = {};
  open = true;
  other?: Peer;
  addEventListener(type: string, fn: (ev: { data?: unknown; code?: number }) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(fn);
    this.listeners[type] = list;
  }
  emit(type: string, ev: { data?: unknown; code?: number }): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  send(data: string): void {
    if (this.open) this.other?.emit("message", { data });
  }
  close(code = 1000): void {
    if (!this.open) return;
    this.open = false;
    if (this.other) this.other.open = false;
    this.other?.emit("close", { code });
    this.emit("close", { code });
  }
}

/** The fake socket server: each connect is a fresh pair, or a refusal while `refuse` is set. */
export class FakeServer {
  readonly servers: Peer[] = [];
  readonly urls: string[] = [];
  refuse = false;
  connect = async (url: string): Promise<SourceSocket> => {
    this.urls.push(url);
    if (this.refuse) throw new Error("INGRESS_SOCKET_REFUSED: the server answered 503");
    const client = new Peer();
    const server = new Peer();
    client.other = server;
    server.other = client;
    this.servers.push(server);
    return client;
  };
  get live(): Peer | undefined {
    return this.servers.at(-1);
  }
}

export function eventJob(source = SOURCE, extra: Partial<JobDefinition> = {}): Partial<JobDefinition> & { steps: JobDefinition["steps"] } {
  return { id: "deploys", title: "Deploy notices", chat: "chat-ada", timing: { schedule: { kind: "interval", every: 60 }, zone: "Europe/London" }, gate: { kind: "event", source }, steps: [{ kind: "diff" }, { kind: "notify" }], ...extra };
}

/** The stream host M6.1's socket tests dial, listed for Ada by default. */
export const STREAM_HOST = "events.solo-sam.example";

export function ingressWorld(o: { listed?: IngressDeps["listed"] } = {}) {
  const clock = { now: T0 };
  const ledgers = ledgerSpace(clock);
  const adaJobs = jobWorld({ owner: ada.email, ledgers, clock });
  /** A second job of Ada's, in its own object, for sources that feed two jobs. */
  const adaSecond = jobWorld({ owner: ada.email, ledgers, clock });
  const worlds = [adaJobs, adaSecond];
  const server = new FakeServer();
  const logs: Record<string, unknown>[] = [];
  /** A job whose next `event` call throws once, as an unreachable object would. */
  const failOnce = new Set<string>();
  const deps: IngressDeps = {
    now: () => clock.now,
    job: (owner, jobId) => ({
      event: async (e: JobEvent): Promise<EventOutcome> => {
        if (failOnce.delete(`${owner}/${jobId}`)) throw new Error("JOB_UNREACHABLE: the object did not answer");
        const w = worlds.find((x) => x.owner === owner && x.status()?.id === jobId);
        return w ? w.engine().event(e) : { ok: false, code: "JOB_UNKNOWN", reason: "no job here" };
      },
    }),
    connect: (url) => server.connect(url),
    listed: o.listed ?? (async (owner, host) => owner === ada.email && host === STREAM_HOST),
    newSecret,
    setAlarm: async (at) => {
      ingress.alarm = at;
    },
    deleteAlarm: async () => {
      ingress.alarm = null;
    },
    log: (e) => void logs.push(e),
  };
  const ingress = {
    alarm: null as number | null,
    harness: new ObjectHarness(SOURCE, (ctx) => new IngressEngine((ctx as DurableObjectState).storage, deps), {}),
    engine: () => ingress.harness.instance,
    /** Moves the clock to the armed alarm and fires it. */
    async fire() {
      const at = ingress.alarm;
      if (at === null) throw new Error("no ingress alarm armed");
      clock.now = Math.max(clock.now, at);
      ingress.alarm = null;
      await ingress.engine().alarm();
    },
  };
  return { clock, ada: adaJobs, adaSecond, server, logs, failOnce, ingress };
}

/** Lets queued socket events and the promises they start settle, without a timer. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
