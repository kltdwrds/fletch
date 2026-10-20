// A hermetic world for Job tests (M5.1): a `Job` engine, the tenant's real `Ledger`, the owner's
// real `ChatEngine`, the real egress module in front of a scripted page, R2 bodies and the fake
// model behind the real adapter. Tests own the store, not the clock: the clock moves only to the
// alarm the object armed, and the alarm is fired explicitly (testing-and-evals.md section 7).
import { publicHostFor, rulesFor } from "../../../packages/agent/src/vault/hosts.ts";
import { ChatEngine, type EngineCtx } from "../../../packages/agent/src/chat/engine.ts";
import { egressFetch, type AuditRow } from "../../../packages/agent/src/egress/module.ts";
import type { JobDefinition } from "../../../packages/agent/src/jobs/body.ts";
import { type JobDeps, JobEngine } from "../../../packages/agent/src/jobs/engine.ts";
import { jobToolSpecs } from "../../../packages/agent/src/jobs/job-tools.ts";
import { completeForJob } from "../../../packages/agent/src/jobs/model.ts";
import type { MemoryApi } from "../../../packages/agent/src/memory/tools.ts";
import type { ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import type { StepHandler } from "../../../packages/agent/src/jobs/steps.ts";
import type { BudgetService } from "@qyvr/host";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { type FakeMode, FakeModel, type FakeStep } from "../../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../../support/object-harness.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { asBucket, FakeR2 } from "./fake-r2.ts";

export const ada = people.people.find((p) => p.id === "sam-solo")!;
/** Tuesday 13 October 2026, 08:00 UTC. */
export const T0 = Date.UTC(2026, 9, 13, 8, 0, 0);
/** A public page on a host the egress policy lists without a credential. */
export const PAGE = "https://hacker-news.firebaseio.com/v0/item/8863.json";

/** The page the watch reads: its body, ETag and status are the test's to change. */
export class Page {
  body = '{"title":"v1"}';
  status = 200;
  etag: string | null = null;
  hits = 0;
  /** The hosts this page answers on; a request to any other fails the test. */
  hosts = new Set(["hacker-news.firebaseio.com"]);
  /** Every URL requested, in order. */
  urls: string[] = [];
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.hits++;
    this.urls.push(url);
    if (!this.hosts.has(new URL(url).hostname)) throw new Error(`unexpected host ${url}`);
    const sent = new Headers(init.headers).get("if-none-match");
    if (this.etag && sent === this.etag) return new Response(null, { status: 304, headers: { etag: this.etag } });
    return new Response(this.body, { status: this.status, headers: { "content-type": "application/json", ...(this.etag ? { etag: this.etag } : {}) } });
  };
}

export function watchBody(o: { id?: string; chat?: string; every?: number; steps?: unknown[]; zone?: string | null; gate?: unknown; extra?: string } = {}): string {
  const lines = ["---", `id: ${o.id ?? "release-watch"}`, "title: Release notes watch", `chat: ${o.chat ?? "chat-ada"}`];
  if (o.zone !== null) lines.push(`zone: ${o.zone ?? "Europe/London"}`);
  lines.push(`schedule: {"kind":"interval","every":${o.every ?? 10}}`);
  lines.push(`gate: ${JSON.stringify(o.gate ?? { kind: "url", url: PAGE })}`);
  if (o.steps) lines.push(`steps: ${JSON.stringify(o.steps)}`);
  if (o.extra) lines.push(o.extra);
  lines.push("---", "Tell me when the release notes change.", "");
  return lines.join("\n");
}

export function jobWorld(o: { tenant?: string; owner?: string; script?: FakeStep[]; mode?: FakeMode; memory?: MemoryApi; docs?: Record<string, string>; extraTools?: ToolSpec[]; steps?: Record<string, StepHandler>; env?: "staging" | "prod"; budget?: BudgetService; ledgers?: ReturnType<typeof ledgerSpace>; clock?: { now: number }; index?: JobDeps["index"]; forget?: JobDeps["forget"] } = {}) {
  const tenant = o.tenant ?? ada.company;
  const owner = o.owner ?? ada.email;
  const clock = o.clock ?? { now: T0 };
  const fake = new FakeModel(o.script ?? [], o.mode ?? { kind: "scripted" });
  const page = new Page();
  const audit: AuditRow[] = [];
  const r2 = new FakeR2();
  const ledgers = o.ledgers ?? ledgerSpace(clock, o.env ?? "staging", o.budget);
  const ledger = () => ledgers.harness(tenant).instance;
  const chats = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new ChatEngine(ctx as EngineCtx, env as Env), {}, (c) => {
    c.now = () => clock.now;
  }));
  const notifyCalls: string[] = [];
  const deps: JobDeps = {
    now: () => clock.now,
    bucket: asBucket(r2) as unknown as JobDeps["bucket"],
    get: (person, purpose) => (url, headers) => egressFetch({ fetch: page.fetch, reveal: async () => ({ ok: false, code: "EGRESS_CRED_UNKNOWN", reason: "none" }), audit: (r) => void audit.push(r), now: () => clock.now, hosts: rulesFor([]), publicHost: publicHostFor(purpose) }, { url, method: "GET", headers }, { person, purpose }),
    ledger: { recordRun: (row) => ledger().recordRun(row) },
    complete: (a) => completeForJob({ ai: fake.binding as unknown as Ai, ledger: ledger(), tenant, now: () => clock.now, wait: async () => {} }, a),
    // The job's read tools as `objects/job.ts` builds them, over this world's page, memory and docs.
    tools: (person, jobId) => [
      ...jobToolSpecs({ owner: person, jobId, get: deps.get(person, `job:${jobId}`), ...(o.memory ? { memory: o.memory } : {}), bucket: { get: async (key) => (o.docs?.[key] !== undefined ? { text: async () => o.docs?.[key] as string } : null) } }),
      ...(o.extraTools ?? []),
    ],
    chat: (id) => ({
      notify: async (n) => {
        notifyCalls.push(n.id);
        return chats.harness(id).instance.notify(n);
      },
      hasNotice: async (nid) => chats.harness(id).instance.hasNotice(nid),
    }),
    ...(o.steps ? { steps: o.steps } : {}),
    ...(o.index ? { index: o.index } : {}),
    ...(o.forget ? { forget: o.forget } : {}),
  };
  const job = new ObjectHarness(`${owner}/job`, (ctx, env) => new JobEngine({ storage: (ctx as { storage: never }).storage }, env as unknown as JobDeps), deps as unknown as Record<string, unknown>);

  const world = {
    tenant, owner, clock, fake, page, audit, r2, job, chats, ledger, notifyCalls,
    engine: () => job.instance,
    /** Writes a body as `writer` and registers it. */
    async register(body: string, by = owner, writer = by) {
      const path = `person/${encodeURIComponent(owner)}/jobs/${/id: (\S+)/.exec(body)?.[1] ?? "job"}.md`;
      await r2.put(path, body, { customMetadata: { writer } });
      return job.instance.register({ owner, by, path });
    },
    async define(def: Partial<JobDefinition> & { steps: JobDefinition["steps"] }, by = owner) {
      const full: JobDefinition = { id: "job", title: "Test job", chat: "chat-ada", owner: { kind: "chat", id: def.chat ?? "chat-ada" }, stop: { kind: "turned_off" }, timing: { schedule: { kind: "interval", every: 10 }, zone: "Europe/London" }, gate: null, ceilingTokens: 20_000, instructions: "Report.", ...def };
      return job.instance.define({ owner, by, def: full });
    },
    claimChat(id = "chat-ada", person = owner) {
      return chats.harness(id).instance.claim(person);
    },
    /** Moves the clock to the armed alarm and fires it. */
    async fire() {
      const at = job.alarmAt;
      if (at === null) throw new Error("no alarm armed");
      clock.now = Math.max(clock.now, at);
      await job.fireAlarm();
    },
    /** Fires every alarm already due (the steps a run armed for now), at most `limit`. */
    async settle(limit = 30) {
      for (let i = 0; i < limit && job.alarmAt !== null && job.alarmAt <= clock.now; i++) await job.fireAlarm();
    },
    /** One scheduled tick: the next alarm, then whatever it armed for now. */
    async tick() {
      await world.fire();
      await world.settle();
    },
    runs: () => job.instance.store.runs(),
    outbox: () => job.instance.store.outbox(),
    status: () => job.instance.status(),
    notices: (id = "chat-ada") => chats.harness(id).instance.notices(),
  };
  return world;
}

/** The tenants' Ledgers on one clock; `budget` is the host's cross-tenant cap, shared by every tenant. */
export function ledgerSpace(clock: { now: number }, env: "staging" | "prod" = "staging", budget?: BudgetService | ((tenant: string) => BudgetService)) {
  return harnessNamespace((name) =>
    new ObjectHarness(name, (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), { QYVR_ENV: env, ...(budget ? { HOST: { budget: typeof budget === "function" ? budget(name) : budget } } : {}) }, (l) => {
      l.now = () => clock.now;
    }),
  );
}
