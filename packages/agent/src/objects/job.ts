// The Job object (AD-1, AD-10), one per job or watch, named `<owner>/<job id>`. It keeps the plain
// Durable Object base and owns its one alarm, which the engine multiplexes (`jobs/engine.ts`); the
// Agents SDK's schedule table would add nothing for an object that holds one job.
import { getAgentByName } from "agents";
import { DurableObject } from "cloudflare:workers";
import { egressFor, type VaultEgress } from "../connectors/egress.ts";
import type { JobDefinition } from "../jobs/body.ts";
import type { JobEvent } from "../jobs/events.ts";
import { type JobDeps, JobEngine } from "../jobs/engine.ts";
import { jobToolSpecs } from "../jobs/job-tools.ts";
import { completeForJob } from "../jobs/model.ts";
import { personMemory } from "../memory/rpc.ts";
import { deliveredNotices } from "../jobs/notices.ts";
import { type EvictMarker, stagingSteps } from "../jobs/staging.ts";
import type { LedgerSink, RunRow } from "../ledger/types.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";

/** The object name for a person's job. */
export const jobName = (owner: string, id: string) => `${owner.trim().toLowerCase()}/${id}`;

export class Job extends DurableObject<Env> {
  private readonly schema = migrateObject(this.ctx, "job");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }
  private engineInstance?: JobEngine;
  /** This instance's id: a reset (`ctx.abort`, an eviction) builds a new one. */
  private readonly instance = crypto.randomUUID();

  private get engine(): JobEngine {
    this.engineInstance ??= new JobEngine({ storage: this.ctx.storage }, this.deps());
    return this.engineInstance;
  }

  private deps(): JobDeps {
    const env = this.env;
    const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID)) as unknown as LedgerSink & { recordRun(row: RunRow): Promise<void> };
    const vault = env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)) as unknown as VaultEgress;
    return {
      now: () => Date.now(),
      bucket: env.AGENT_BUCKET,
      get: (person, purpose) => {
        const egress = egressFor(vault, person);
        return (url, headers) => egress({ url, method: "GET", headers }, purpose);
      },
      ledger,
      // The job's read tools (M25.2), for its owner alone: `jobLoop` runs only the read-only ones.
      tools: (owner, jobId) => {
        const egress = egressFor(vault, owner);
        return jobToolSpecs({ owner, jobId, get: (url, headers) => egress({ url, method: "GET", headers }, `job:${jobId}`), memory: personMemory(env, owner), egress, bucket: env.AGENT_BUCKET });
      },
      complete: (a) => completeForJob({ ai: env.AI, ledger, tenant: env.TENANT_ID, now: () => Date.now(), wait: (ms) => new Promise((r) => setTimeout(r, ms)) }, a),
      // Through the owner's delivery (M14.1): into this chat at once, pushed or mailed when no client is open.
      chat: (chatId) =>
        deliveredNotices(chatId, {
          deliver: async (person, input) => (await getAgentByName(env.PERSON, person)).deliver(input),
          hasNotice: async (id) => (await getAgentByName(env.CHAT, chatId)).hasNotice(id),
        }),
      index: async (owner, id) => (await getAgentByName(env.PERSON, owner)).noteJob(id),
      forget: async (owner, id) => (await getAgentByName(env.PERSON, owner)).forgetJob(id),
      // Staging only: the fixture step that resets this object mid-step (M5.2's live lane).
      steps: stagingSteps(env.QYVR_ENV, () => ({
        marker: { get: (k) => this.ctx.storage.kv.get(k), put: (k, v) => this.ctx.storage.kv.put(k, v) },
        sync: () => this.ctx.storage.sync(),
        abort: (reason) => this.ctx.abort(reason),
        instance: this.instance,
      })),
    };
  }

  async fetch(): Promise<Response> {
    return Response.json({ code: "NOT_IMPLEMENTED", object: "Job" }, { status: 501 });
  }

  async alarm(): Promise<void> {
    await this.engine.alarm();
  }

  async register(a: { owner: string; by: string; path: string }) {
    return this.engine.register(a);
  }

  async define(a: { owner: string; by: string; def: JobDefinition }) {
    return this.engine.define(a);
  }

  async enable(by: string) {
    return this.engine.enable(by);
  }

  async disable(by: string) {
    return this.engine.disable(by);
  }

  async runNow(by: string) {
    return this.engine.runNow(by);
  }

  async remove(by: string) {
    return this.engine.remove(by);
  }

  /** An event from the owner's `Ingress` source (M6.1): one gate evaluation per event id. */
  async event(e: JobEvent) {
    return this.engine.event(e);
  }

  async resolveApproval(a: { runId: string; step: number; approve: boolean; by: string }) {
    return this.engine.resolveApproval(a);
  }

  async status() {
    return this.engine.status();
  }

  /** The owner's view of the job, with this instance's id and any resets the evict step made. */
  async inspect(by: string) {
    const s = this.engine.inspect(by);
    if (!s.ok) return s;
    const evictions: Record<string, EvictMarker> = {};
    for (const [k, v] of this.ctx.storage.kv.list<EvictMarker>({ prefix: "evicted:" })) evictions[k.slice("evicted:".length)] = v;
    return { ...s, instance: this.instance, evictions };
  }
}
