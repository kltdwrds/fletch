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
const SLOT = Date.UTC(2026, 9, 13, 11);

async function world(script: Parameters<typeof authorityWorld>[0] = {}) {
  const w = authorityWorld({ stores: true, roles: { [ada.email]: "owner" }, ...script });
  await w.company().createTeam(ada.email, { id: "ops", name: "Operations" });
  return w;
}
const runsOf = async (w: Awaited<ReturnType<typeof world>>, job: string) => (await w.ledger().runs({ person: COMPANY_OWNER })).filter((r) => r.jobId === job);

describe("[M12.1] company loops", () => {

  it("the company store holds the rule: a claim citing a personal or team line is refused, and only a loop writes claims", () => {
    const h = new ObjectHarness("company", (ctx) => new CompanyMemory((ctx as DurableObjectState).storage, { reader: (email) => ({ email, member: true, teams: ["ops"] }), isAdmin: () => true, now: () => SLOT }), {});
    expect(h.instance.addCompanyClaim({ text: "x", cite: "memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "teams/ops/memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "company/memory/2026-10-13.md#L3", supersedes: null, writer: "loop:company-upkeep" })).toMatchObject({ ok: false, code: "LOOP_CITATION_UNRESOLVED" });
    expect(h.instance.addCompanyClaim({ text: "x", cite: "company/memory/2026-10-13.md#L3", supersedes: null, writer: `agent:${ada.email}` })).toMatchObject({ ok: false, code: "SCOPE_WRITER_INVALID" });
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
