// M12.1 the company's loops on `solo-sam` with Ada (owner) and Bo (member), each with real personal
// memory over the same bucket: company upkeep reads company scope only and touches no personal note,
// asserted over the bucket's write log and each person's tables; its claims cite company lines that
// resolve; the company skill review sends refereed proposals to the admins' queue and merges nothing;
// the cost report renders for a simulated month with no model call, to admins only; the onboarding
// study is a loop with its switch and Ledger row; a company loop over budget stops and records it.
import { describe, expect, it } from "vitest";
import { COMPANY_OWNER, nextDue } from "../../packages/agent/src/loops/company.ts";
import { CompanyMemory } from "../../packages/agent/src/memory/company.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { answer } from "./support/loop-world.ts";

const verdict = (v: "promote" | "reject", reason = "fine") => ({ text: JSON.stringify({ verdict: v, reason }) });
const SLOT = Date.UTC(2026, 9, 13, 11);

async function world(script: Parameters<typeof authorityWorld>[0] = {}) {
  const w = authorityWorld({ stores: true, roles: { [ada.email]: "owner" }, ...script });
  await w.company().createTeam(ada.email, { id: "ops", name: "Operations" });
  return w;
}

const personal = (w: Awaited<ReturnType<typeof world>>, p: string, text: string) =>
  w.host(p).memory.memoryWrite({ target: "daily", text }, { requester: p, setting: { scope: "personal" }, source: "chat:test", dedupe: crypto.randomUUID() });
const company = async (w: Awaited<ReturnType<typeof world>>, text: string) => {
  const r = await w.company().memoryAppend(ada.email, { scope: "company", text, writer: `person:${ada.email}`, source: "admin-ui" });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.citation;
};
const runsOf = async (w: Awaited<ReturnType<typeof world>>, job: string) => (await w.ledger().runs({ person: COMPANY_OWNER })).filter((r) => r.jobId === job);

describe("[M12.1] company loops", () => {

  it("the company store holds the rule: a claim citing a personal or team line is refused, and only a loop writes claims", () => {
    const h = new ObjectHarness("company", (ctx) => new CompanyMemory((ctx as DurableObjectState).storage, { reader: (email) => ({ email, member: true, teams: ["ops"] }), isAdmin: () => true, now: () => SLOT }), {});
    expect(h.instance.addCompanyClaim({ text: "x", cite: "memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "teams/ops/memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "company/memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "company/memory/2026-10-13.md#L3", supersedes: null, writer: `agent:${ada.email}` })).toMatchObject({ ok: false, code: "SCOPE_WRITER_INVALID" });
  });

  it("no new company-scope lines produce no model call, for upkeep and the skill review", async () => {
    const w = await world();
    await personal(w, ada.email, "Ada's own line is not company evidence.");
    await w.company().memoryAppend(other.email, { scope: "team:ops", text: "A team line is not company evidence.", writer: `person:${other.email}`, source: "chat:1" });
    expect(await w.company().runLoop("company-upkeep", SLOT)).toMatchObject({ signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", calls: 0 });
    expect(await w.company().runLoop("company-skill-review", SLOT)).toMatchObject({ signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", calls: 0 });
    expect(w.fake.requests).toHaveLength(0);
    expect(await runsOf(w, "loop:company-upkeep")).toMatchObject([{ code: "LOOP_NO_EVIDENCE", tokens: 0 }]);
    expect(await runsOf(w, "loop:company-skill-review")).toMatchObject([{ code: "LOOP_NO_EVIDENCE", tokens: 0 }]);
  });

  it("the company skill review sends refereed proposals to the admins' queue and never merges", async () => {
    const w = await world();
    const c1 = await company(w, "Every Friday we post the harbor digest from Hacker News links.");
    w.fake.enqueue(
      answer({
        skills: [
          { name: "harbor-digest", description: "Post the Friday harbor digest.", body: "Collect the week's links and post the digest.", tools: [], connectors: ["hackernews"], cites: [c1] },
          { name: "repo-sweep", description: "Sweep the repositories.", body: "List open pull requests.", tools: [], connectors: ["github"], cites: [c1] },
          { name: "uncited", description: "Nothing shows it.", body: "Do it.", cites: [] },
        ],
      }),
      verdict("promote", "a clean company procedure"),
    );
    const ran = await w.company().runLoop("company-skill-review", SLOT);
    expect(ran).toMatchObject({ signal: "notify", calls: 1 });
    // One review call and one referee call: the github skill failed narrowing before any referee.
    expect(w.fake.requests).toHaveLength(2);
    const queue = await w.company().promotions(ada.email);
    expect(queue.map((p) => [p.name, p.status, p.origin, p.proposer])).toEqual([
      ["harbor-digest", "ready", "review", "loop:company-skill-review"],
      ["repo-sweep", "rejected", "review", "loop:company-skill-review"],
    ]);
    expect(queue[1]?.code).toBe("PROMOTION_EXCEEDS_SCOPE");
    // Bo is not a key holder for company scope and sees none of it; nothing was merged or written.
    expect(await w.company().promotions(other.email)).toEqual([]);
    expect([...w.r2.objects.keys()].filter((k) => k.startsWith("skills/company/"))).toEqual([]);
    expect((await w.company().loopReport(ada.email, "company-skill-review")) as unknown).toMatchObject({ reconciliations: [{ added: [queue[0]?.id], dropped: [{ code: "PROMOTION_EXCEEDS_SCOPE" }, { code: "LOOP_CITATION_UNRESOLVED" }] }] });
    // The merge stays a human's: an admin in person merges it.
    expect(await w.company().promotionMerge({ kind: "agent", email: ada.email }, queue[0]?.id as string)).toMatchObject({ ok: false, code: "PROMOTION_PERSON_ONLY" });
  });

  it("the cost report renders for a simulated month without a model call, to admins only", async () => {
    const w = await world();
    const sep = (d: number, h = 9) => Date.UTC(2026, 8, d, h);
    const call = (person: string, runId: string, at: number, input: number, output: number) =>
      w.ledger().record({ tenant: "solo-sam", person, runId, route: "chat", model: "@cf/zai-org/glm-5.3-flash", attempt: 1, status: "ok", code: null, httpStatus: 200, inputTokens: input, outputTokens: output, reasoningTokens: 0, cachedTokens: 0, at, startedAt: null, firstTokenAt: null, finishedAt: null });
    await call(ada.email, "chat-1", sep(2), 1_000, 200);
    await call(ada.email, "run-watch-1", sep(9), 300, 50);
    await call(other.email, "chat-2", sep(15), 2_000, 500);
    await call(other.email, "loop:memory-upkeep:2026-09-15T10:00:00.000Z", sep(15, 10), 400, 100);
    await call(COMPANY_OWNER, "loop:company-upkeep:2026-09-30T23:00:00.000Z", sep(30, 23), 600, 100);
    // Outside the month: the last day of August and the first of October.
    await call(ada.email, "chat-3", Date.UTC(2026, 7, 31, 23), 9_000, 9_000);
    await call(other.email, "chat-4", Date.UTC(2026, 9, 1, 0), 9_000, 9_000);
    await w.ledger().recordRun({ runId: "run-watch-1", jobId: "watch-hn", person: ada.email, scheduledFor: sep(9), phase: "done", attempt: 1, step: 1, leaseUntil: null, timeoutAt: null, tokens: 0, costMicros: 0, signal: "notify", code: null, reason: null, nextProbe: null, startedAt: sep(9), updatedAt: sep(9) });

    const ran = await w.company().runLoop("cost-report", Date.UTC(2026, 9, 1, 6));
    expect(ran).toMatchObject({ ok: true, signal: "notify", calls: 0 });
    expect(w.fake.requests).toHaveLength(0);
    const r = await w.company().costReport(ada.email, "2026-09");
    expect(r).toMatchObject({ ok: true, report: { month: "2026-09", totals: { calls: 5, tokens: 5_250 } } });
    const report = (r as { report: { people: unknown[]; jobs: unknown[]; markdown: string } }).report;
    expect(report.people).toMatchObject([
      { name: other.email, calls: 2, tokens: 3_000 },
      { name: ada.email, calls: 2, tokens: 1_550 },
      { name: COMPANY_OWNER, calls: 1, tokens: 700 },
    ]);
    expect(report.jobs).toMatchObject([
      { name: "chat", calls: 2, tokens: 3_700 },
      { name: "loop:company-upkeep", calls: 1, tokens: 700 },
      { name: "loop:memory-upkeep", calls: 1, tokens: 500 },
      { name: "watch-hn", calls: 1, tokens: 350 },
    ]);
    expect(report.markdown).toContain("# Cost report 2026-09");
    expect(report.markdown).toContain("5 model calls, 5250 tokens");
    expect(report.markdown).toContain(`| ${other.email} | 2 | 3000 |`);
    expect(report.markdown).toContain("| watch-hn | 1 | 350 |");
    expect(await w.company().costReport(other.email, "2026-09")).toMatchObject({ ok: false, code: "NOT_AN_ADMIN" });
    expect(await runsOf(w, "loop:cost-report")).toMatchObject([{ signal: "notify", tokens: 0 }]);
  });

  it("a company loop over budget stops and records it; only admins switch or budget the company's loops", async () => {
    const w = await world();
    for (let i = 0; i < 45; i++) await company(w, `Dock rule ${i}: boats tie up bow first.`);
    expect(await w.company().setLoop(other.email, "company-upkeep", { budget: 1 })).toMatchObject({ ok: false, code: "NOT_AN_ADMIN" });
    expect(await w.company().setLoop(ada.email, "company-upkeep", { budget: 1_000 })).toMatchObject({ ok: true });
    w.fake.enqueue(answer({ claims: [] }, { prompt: 900, completion: 300 }), answer({ claims: [] }));
    const ran = await w.company().runLoop("company-upkeep", SLOT);
    expect(ran).toMatchObject({ ok: false, signal: "blocked", code: "LOOP_BUDGET_EXHAUSTED", calls: 1 });
    expect(w.fake.requests).toHaveLength(1);
    expect(await runsOf(w, "loop:company-upkeep")).toMatchObject([{ signal: "blocked", code: "LOOP_BUDGET_EXHAUSTED", tokens: 1_200 }]);
    expect(await w.company().loopReport(ada.email, "company-upkeep")).toMatchObject({ reconciliations: [{ lines: 40 }] });
  });

  it("the onboarding study is a loop: switched off it makes no call; run, it is the company's Ledger row", async () => {
    const w = await world({ shape: "standalone", seed: [ada], onboarding: true });
    await w.company().onboardingSkip({ kind: "person", email: ada.email }, "connect");
    expect(await w.company().setLoop(ada.email, "onboarding-study", { enabled: false })).toMatchObject({ ok: true });
    expect(await w.company().onboardingStudy({ kind: "person", email: ada.email }, "handbook")).toMatchObject({ ok: false, code: "LOOP_DISABLED" });
    expect(w.fake.requests).toHaveLength(0);
    await w.company().setLoop(ada.email, "onboarding-study", { enabled: true });
    w.fake.enqueue(answer({ items: [{ text: "Solo Sam calls its Monday planning the harbor meeting." }] }));
    expect(await w.company().onboardingStudy({ kind: "person", email: ada.email }, "handbook")).toMatchObject({ ok: true, draft: [{ id: "d1" }] });
    expect(await runsOf(w, "loop:onboarding-study")).toMatchObject([{ signal: "notify", tokens: 500 }]);
    expect(await w.company().loopSettings(ada.email)).toMatchObject({ ok: true, loops: expect.arrayContaining([{ loop: "onboarding-study", enabled: true, budget: 20_000 }]) });
  });

  it("the company's loops are due hourly, on Mondays at 04:00 and on the first at 06:00 (UTC)", () => {
    expect(nextDue("company-upkeep", Date.UTC(2026, 9, 13, 10, 30))).toBe(Date.UTC(2026, 9, 13, 11));
    expect(nextDue("company-skill-review", Date.UTC(2026, 9, 13, 10))).toBe(Date.UTC(2026, 9, 19, 4));
    expect(nextDue("company-skill-review", Date.UTC(2026, 9, 19, 3))).toBe(Date.UTC(2026, 9, 19, 4));
    expect(nextDue("company-skill-review", Date.UTC(2026, 9, 19, 4))).toBe(Date.UTC(2026, 9, 26, 4));
    expect(nextDue("cost-report", Date.UTC(2026, 9, 13))).toBe(Date.UTC(2026, 10, 1, 6));
    expect(nextDue("cost-report", Date.UTC(2026, 11, 1, 5))).toBe(Date.UTC(2026, 11, 1, 6));
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
