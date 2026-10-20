// The Ingress object (AD-1, AD-4, M6.1), one per push source, named by its random source id. It keeps
// the plain Durable Object base and owns its alarm (`ingress/engine.ts`): webhooks arrive through the
// agent script's `/hooks/<id>` route, and a socket source is an outbound WebSocket opened with a
// fetch upgrade, which the alarm reconnects after a drop or an eviction.
import { DurableObject } from "cloudflare:workers";
import { socketUpgrade } from "../egress/outbound.ts";
import { type IngressDeps, IngressEngine, type SourceSocket } from "../ingress/engine.ts";
import { newSecret } from "../ingress/signature.ts";
import type { SourceKind } from "../ingress/store.ts";
import type { JobEvent } from "../jobs/events.ts";
import type { EventOutcome } from "../jobs/engine.ts";
import { jobName } from "./job.ts";
import { logObject } from "../obs/log.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";

/** Opens an outbound WebSocket the way Workers do: a fetch with the upgrade header, then accept. */
async function openSocket(url: string): Promise<SourceSocket> {
  const res = await socketUpgrade(url.replace(/^wss:/, "https:"));
  const ws = res.webSocket;
  if (!ws) throw new Error(`INGRESS_SOCKET_REFUSED: the server answered ${res.status}`);
  ws.accept();
  return ws as unknown as SourceSocket;
}

export class Ingress extends DurableObject<Env> {
  private readonly schema = migrateObject(this.ctx, "ingress");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }
  private engineInstance?: IngressEngine;

  private get engine(): IngressEngine {
    this.engineInstance ??= new IngressEngine(this.ctx.storage, this.deps());
    return this.engineInstance;
  }

  private deps(): IngressDeps {
    const env = this.env;
    return {
      now: () => Date.now(),
      job: (owner, jobId) => ({
        event: (e: JobEvent) => (env.JOB.get(env.JOB.idFromName(jobName(owner, jobId))) as unknown as { event(e: JobEvent): Promise<EventOutcome> }).event(e),
      }),
      connect: openSocket,
      listed: async (owner, host) => (await (env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)) as unknown as { listsHost(person: string, host: string): Promise<boolean> }).listsHost(owner, host)),
      newSecret,
      setAlarm: (at) => this.ctx.storage.setAlarm(at),
      deleteAlarm: () => this.ctx.storage.deleteAlarm(),
      log: (event) => logObject({ ...event, tenant: env.TENANT_ID }),
    };
  }

  async fetch(): Promise<Response> {
    return Response.json({ code: "NOT_IMPLEMENTED", object: "Ingress" }, { status: 501 });
  }

  async alarm(): Promise<void> {
    await this.engine.alarm();
  }

  async create(a: { id: string; owner: string; kind: SourceKind; jobs: string[]; dryRun?: boolean; url?: string }) {
    return this.engine.create(a);
  }

  async webhook(headers: Record<string, string | undefined>, body: string) {
    return this.engine.webhook(headers, body);
  }

  async inspect(by: string) {
    return this.engine.inspect(by);
  }

  async setDryRun(by: string, dryRun: boolean) {
    return this.engine.setDryRun(by, dryRun);
  }

  async start(by: string) {
    return this.engine.start(by);
  }

  async stop(by: string) {
    return this.engine.stop(by);
  }
}
