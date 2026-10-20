// M6.1: signed webhooks into an `Ingress`, each accepted event one gate evaluation in the owner's
// subscribed `Job` (AD-3, AD-4). Two members: Ada's source feeds Ada's job and never Bo's. Every
// guard is exercised on the production path: the engine's `webhook`, the `Job`'s `event`.
import { describe, expect, it } from "vitest";
import { EVENT_LEASE_MS } from "../../packages/agent/src/ingress/engine.ts";
import { serve } from "../../packages/agent/src/http/serve.ts";
import type { IngressStub } from "../../packages/agent/src/http/ingress-routes.ts";
import type { Directory } from "../../packages/agent/src/http/routes.ts";
import { signWebhook } from "../../packages/agent/src/ingress/signature.ts";
import { ada } from "./support/job-world.ts";
import { eventJob, ingressWorld, SOURCE } from "./support/ingress-world.ts";

const body = '{"deploy":"web","status":"done"}';

async function setup(o: { dryRun?: boolean; jobs?: string[] } = {}) {
  const w = ingressWorld();
  w.ada.claimChat("chat-ada", ada.email);
  expect(await w.ada.define(eventJob())).toMatchObject({ ok: true, status: "active" });
  const created = await w.ingress.engine().create({ id: SOURCE, owner: ada.email, kind: "webhook", jobs: o.jobs ?? ["deploys"], dryRun: o.dryRun });
  if (!created.ok || !created.secret) throw new Error("source not created");
  const send = async (id: string, payload = body, secret = created.secret as string, at = w.clock.now) => w.ingress.engine().webhook(await signWebhook(secret, id, Math.floor(at / 1000), payload), payload);
  return { ...w, secret: created.secret, send };
}

describe("[M6.1] webhook ingress", () => {
  it("rejects a bad signature, a missing one and a replayed stale one, logs each, and evaluates nothing", async () => {
    const w = await setup();
    const other = `whsec_${btoa("x".repeat(32))}`;
    expect(await w.send("evt-1", body, other)).toMatchObject({ status: 401, code: "HOOK_SIGNATURE_INVALID" });
    expect(await w.ingress.engine().webhook({ "webhook-id": "evt-2" }, body)).toMatchObject({ status: 401, code: "HOOK_HEADERS_MISSING" });
    // A good signature over a different body: the signature covers the body.
    const signed = await signWebhook(w.secret, "evt-3", Math.floor(w.clock.now / 1000), body);
    expect(await w.ingress.engine().webhook(signed, '{"deploy":"web","status":"failed"}')).toMatchObject({ status: 401, code: "HOOK_SIGNATURE_INVALID" });
    // A captured, valid delivery replayed six minutes later.
    w.clock.now += 6 * 60_000;
    expect(await w.ingress.engine().webhook(signed, body)).toMatchObject({ status: 401, code: "HOOK_TIMESTAMP_STALE" });

    const seen = w.ingress.engine().inspect(ada.email);
    if (!seen.ok) throw new Error(seen.code);
    expect(seen.rejects.map((r) => r.code)).toEqual(["HOOK_SIGNATURE_INVALID", "HOOK_HEADERS_MISSING", "HOOK_SIGNATURE_INVALID", "HOOK_TIMESTAMP_STALE"]);
    expect(w.logs.filter((l) => l.event === "ingress.rejected").map((l) => l.code)).toEqual(seen.rejects.map((r) => r.code));
    expect(seen.events).toEqual([]);
    expect(w.ada.engine().events.list()).toEqual([]);
    expect(w.ada.runs()).toEqual([]);
  });

  it("turns a good event into exactly one gate evaluation, however often the sender delivers it", async () => {
    const w = await setup();
    expect(await w.send("evt-1")).toMatchObject({ status: 202, code: "INGRESS_ACCEPTED" });
    expect(await w.send("evt-1")).toMatchObject({ status: 200, code: "INGRESS_DUPLICATE" });
    w.clock.now += 60_000;
    expect(await w.send("evt-1")).toMatchObject({ status: 200, code: "INGRESS_DUPLICATE" });
    expect(w.ada.engine().events.list()).toEqual([expect.objectContaining({ eventId: "evt-1", source: SOURCE, open: true })]);

    // The open evaluation is one run; its steps run one per alarm and the notice lands fenced in Ada's chat once.
    await w.ada.settle();
    expect(w.ada.runs()).toEqual([expect.objectContaining({ runId: `deploys:event:evt-1`, phase: "done", signal: "notify" })]);
    const notices = w.ada.notices("chat-ada");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toContain(`[BEGIN EXTERNAL CONTENT source="hook:${SOURCE}"]\n${body}\n[END EXTERNAL CONTENT`);
    expect(w.ada.fake.requests).toHaveLength(0);
  });

  it("queues an event that arrives while a run is in progress, and runs it after", async () => {
    const w = await setup();
    await w.send("evt-1");
    await w.send("evt-2", '{"deploy":"api","status":"done"}');
    expect(w.ada.engine().events.list().map((e) => [e.eventId, e.open])).toEqual([["evt-1", true], ["evt-2", true]]);
    await w.ada.settle();
    expect(w.ada.runs().map((r) => [r.runId, r.signal])).toEqual([["deploys:event:evt-1", "notify"], ["deploys:event:evt-2", "notify"]]);
    expect(w.ada.notices("chat-ada")).toHaveLength(2);
  });

  it("holds a delivery under a lease: a crash mid-delivery re-delivers once, and no job evaluates twice", async () => {
    const w = await setup({ jobs: ["deploys", "rollbacks"] });
    // A second job of Ada's on the same source, whose object fails once mid-delivery, after the first job evaluated.
    w.adaSecond.claimChat("chat-ada", ada.email);
    expect(await w.adaSecond.define(eventJob(SOURCE, { id: "rollbacks" }))).toMatchObject({ ok: true });
    w.failOnce.add(`${ada.email}/rollbacks`);
    expect(await w.send("evt-1")).toMatchObject({ status: 503, code: "INGRESS_DELIVERY_FAILED" });
    expect(w.ada.engine().events.list()).toHaveLength(1);
    expect(w.adaSecond.engine().events.list()).toHaveLength(0);
    const leased = w.ingress.engine().inspect(ada.email);
    expect(leased.ok && leased.events).toEqual([expect.objectContaining({ eventId: "evt-1", state: "leased", attempts: 1 })]);
    // The sender's retry inside the lease waits; the lease's alarm re-delivers.
    expect(await w.send("evt-1")).toMatchObject({ status: 409, code: "INGRESS_IN_FLIGHT" });
    expect(w.ingress.alarm).toBe(w.clock.now + EVENT_LEASE_MS);
    await w.ingress.fire();
    const done = w.ingress.engine().inspect(ada.email);
    expect(done.ok && done.events).toEqual([expect.objectContaining({ eventId: "evt-1", state: "done", attempts: 2 })]);
    // The re-delivery found the first job's evaluation already made; the second job evaluated once.
    expect(done.ok && done.deliveries.map((d) => [d.job, d.outcome.duplicate])).toEqual([["deploys", true], ["rollbacks", false]]);
    expect(w.ada.engine().events.list()).toHaveLength(1);
    expect(w.adaSecond.engine().events.list()).toHaveLength(1);
    expect(await w.send("evt-1")).toMatchObject({ status: 200, code: "INGRESS_DUPLICATE" });
  });

  it("records what a dry run would evaluate and evaluates nothing", async () => {
    const w = await setup({ dryRun: true });
    expect(await w.send("evt-1")).toMatchObject({ status: 202, code: "INGRESS_DRY_RUN" });
    const seen = w.ingress.engine().inspect(ada.email);
    expect(seen.ok && seen.deliveries).toEqual([{ eventId: "evt-1", job: "deploys", outcome: { dryRun: true, wouldEvaluate: true } }]);
    expect(w.ada.engine().events.list()).toEqual([]);
    expect(await w.ingress.engine().setDryRun(ada.email, false)).toEqual({ ok: true });
    expect(await w.send("evt-2")).toMatchObject({ status: 202, code: "INGRESS_ACCEPTED" });
    expect(w.ada.engine().events.list().map((e) => e.eventId)).toEqual(["evt-2"]);
  });

  it("evaluates an event gate's condition in code, records a closed evaluation once, and never opens on a scheduled tick", async () => {
    const w = ingressWorld();
    w.ada.claimChat("chat-ada", ada.email);
    await w.ada.define(eventJob(SOURCE, { gate: { kind: "event", source: SOURCE, pointer: "/status", equals: "failed" } }));
    await w.ingress.engine().create({ id: SOURCE, owner: ada.email, kind: "webhook", jobs: ["deploys"] });
    const ev = (id: string, payload: string) => w.ada.engine().event({ eventId: id, source: SOURCE, owner: ada.email, payload });
    expect(await ev("a", body)).toMatchObject({ ok: true, duplicate: false, open: false, why: "no_match" });
    expect(await ev("a", body)).toMatchObject({ ok: true, duplicate: true, open: false });
    expect(await ev("b", "not json")).toMatchObject({ open: false, why: "not_json" });
    expect(await ev("c", '{"status":"failed"}')).toMatchObject({ open: true });
    expect(await w.ada.engine().event({ eventId: "d", source: "f".repeat(32), owner: ada.email, payload: body })).toMatchObject({ open: false, why: "other_source" });
    await w.ada.settle();
    expect(w.ada.runs().map((r) => r.runId)).toEqual(["deploys:event:c"]);
    for (let i = 0; i < 3; i++) await w.ada.tick();
    expect(w.ada.runs()).toHaveLength(1);
  });

  it("serves /hooks/<id> on the tenant hostname without a session, the signature deciding, while the owner's routes still need one", async () => {
    const w = await setup();
    const engine = w.ingress.engine();
    const dir = { ingress: (id: string) => (id === SOURCE ? engine : null) as unknown as IngressStub } as unknown as Directory;
    const env = { TENANT_ID: "solo-sam", TENANT_SHAPE: "company", QYVR_ENV: "staging", ACCESS_ISSUER: "https://team.cloudflareaccess.com", ACCESS_AUD: "aud", ACCESS_LIVE_CLIENT_ID: "" };
    const agent = (path: string, init: RequestInit) =>
      serve(new Request(`https://solo-sam.example${path}`, init), env as never, { tenant: "solo-sam" }, { dir, keys: { keys: async () => [] } as never, now: () => w.clock.now });
    const code = async (r: Response) => [r.status, ((await r.json()) as { code: string }).code];
    const signed = await signWebhook(w.secret, "evt-h", Math.floor(w.clock.now / 1000), body);
    // Only the three signature headers reach the Ingress; an Access-looking header changes nothing.
    expect(await code(await agent(`/hooks/${SOURCE}`, { method: "POST", headers: { ...signed, "cf-access-authenticated-user-email": ada.email }, body }))).toEqual([202, "INGRESS_ACCEPTED"]);
    expect(await code(await agent(`/hooks/${SOURCE}`, { method: "POST", headers: { "webhook-id": "evt-u" }, body }))).toEqual([401, "HOOK_HEADERS_MISSING"]);
    expect(await code(await agent("/hooks/not-a-source", { method: "POST", body }))).toEqual([404, "INGRESS_UNKNOWN"]);
    expect(await code(await agent(`/hooks/${SOURCE}`, { method: "GET" }))).toEqual([405, "METHOD_NOT_ALLOWED"]);
    expect(w.ada.engine().events.list().map((e) => e.eventId)).toEqual(["evt-h"]);
    // The owner's management route is behind the session like every other route.
    expect((await agent(`/api/hooks/${SOURCE}`, { method: "GET" })).status).toBe(401);
  });
});
