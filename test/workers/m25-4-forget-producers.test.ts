// M25.4: forget reaches future producers (MEM-7). A forget plan names the jobs and skills whose text holds the fact it
// removes, so the person sees what would write it back before confirming. The match is code: the claim's words in a row,
// or most of its distinctive words. A source that cannot be read is named in the plan, never counted as clean, and nothing
// in a job or a skill is changed by planning. Ada's plan reads Ada's producers; Bo's own jobs and skills are his.
import { describe, expect, it } from "vitest";
import { Person } from "../../packages/agent/src/index.ts";
import { holds, type ForgetProducers } from "../../packages/agent/src/memory/forget.ts";
import { personalSkillsPrefix } from "../../packages/agent/src/learning/personal.ts";
import { migrateObject } from "../../packages/agent/src/migrations/catalog.ts";
import type { MemoryService } from "../../packages/agent/src/memory/service.ts";
import { seedClaim } from "./support/seed-claim.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { ada, T0 } from "./support/authority-world.ts";
import { asBucket, FakeR2 } from "./support/fake-r2.ts";
import { memoryFor } from "./support/memory-harness.ts";

const FACT = "Ada moved the harbor review to Thursdays.";
const producers = (jobs: Array<{ id: string; text: string }>, skills: Array<{ name: string; text: string }>): ForgetProducers => ({ jobs: async () => jobs, skills: async () => skills });
const planOf = (r: unknown) => {
  expect(r).toMatchObject({ ok: true });
  return r as { planId: string; rederives: Array<{ kind: string; id: string; how: string; claims: string[] }>; unchecked: Array<{ source: string; reason: string }> };
};

describe("[M25.4] forget reaches future producers", () => {
  it("the plan lists the job bodies and skills that hold the fact, word for word or by most of its words, and leaves them unchanged", async () => {
    const m = memoryFor();
    const w = (await m.write(FACT, { claim: { kind: "event" } })) as unknown as { claimId: string };
    const jobs = [
      { id: "harbor-watch", text: "Harbor watch\nEvery morning, remind Ada that Ada moved the harbor review to Thursdays. Say so only if the page changed." },
      { id: "tide-chart", text: "Tide chart\nCheck the tide table for the north barn on Fridays." },
    ];
    const skills = [
      { name: "weekly-review", text: "---\nname: weekly-review\n---\nPrepare the harbor review for Thursday; the review was moved to Thursdays by Ada." },
      { name: "barn-shipping", text: "---\nname: barn-shipping\n---\nThe north barn ships on Fridays." },
    ];
    const before = JSON.stringify([jobs, skills]);
    const plan = planOf(await m.svc().forgetPlan({ claimIds: [w.claimId] }, ada.email, producers(jobs, skills)));
    expect(plan.rederives).toEqual([
      { kind: "job", id: "harbor-watch", how: "exact", claims: [w.claimId] },
      { kind: "skill", id: "weekly-review", how: "words", claims: [w.claimId] },
    ]);
    expect(plan.unchecked).toEqual([]);
    expect(JSON.stringify([jobs, skills])).toBe(before);
    // Confirming still forgets the fact; the list was the person's to read first.
    expect(await m.svc().forgetConfirm(plan.planId, ada.email)).toMatchObject({ ok: true, claims: 1 });
  });

  it("a plan with no producers named holds nothing back and says nothing is unchecked; a producer source that fails is named, with its reason", async () => {
    const m = memoryFor();
    const w = (await m.write(FACT, { claim: { kind: "event" } })) as unknown as { claimId: string };
    expect(planOf(await m.svc().forgetPlan({ claimIds: [w.claimId] }, ada.email, producers([], [])))).toMatchObject({ rederives: [], unchecked: [] });
    const broken: ForgetProducers = { jobs: async () => { throw new Error("job harbor-watch could not be read: JOB_UNKNOWN"); }, skills: async () => [{ name: "weekly-review", text: FACT }] };
    expect(planOf(await m.svc().forgetPlan({ claimIds: [w.claimId] }, ada.email, broken))).toMatchObject({
      rederives: [{ kind: "skill", id: "weekly-review", how: "exact" }],
      unchecked: [{ source: "jobs", reason: expect.stringContaining("JOB_UNKNOWN") }],
    });
  });

  it("the match is by whole facts: short or unrelated text never matches (pure)", () => {
    expect(holds("Ada moved the harbor review to Thursdays.", FACT)).toBe("exact");
    expect(holds("ada   MOVED the harbor review\nto thursdays.", FACT)).toBe("exact");
    expect(holds("The harbor review is on Thursday; Ada moved it.", FACT)).toBe("words");
    expect(holds("The north barn ships on Fridays.", FACT)).toBeNull();
    expect(holds("The harbor is wide.", FACT)).toBeNull();
    expect(holds(FACT, "Ada.")).toBeNull();
  });
});

describe("[M25.4] forget reaches future producers: the production Person", () => {
  it("Person.forgetPlan reads the owner's job definitions through their Job objects and the owner's skills from the bucket", async () => {
    const r2 = new FakeR2();
    const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}));
    const inspected: string[] = [];
    const def = (title: string, instructions: string) => ({ title, instructions, steps: [{ kind: "model", prompt: "Summarise what changed." }, { kind: "notify" }] });
    const defs: Record<string, ReturnType<typeof def>> = {
      "harbor-watch": def("Harbor watch", `Remind Ada weekly: ${FACT}`),
      "tide-chart": def("Tide chart", "Check the tide table."),
    };
    const JOB = {
      idFromName: (n: string) => n,
      get: (n: string) => ({
        inspect: async (by: string) => {
          inspected.push(`${by}:${n}`);
          const id = n.split("/")[1] as string;
          return n.startsWith(`${ada.email}/`) && defs[id] ? { ok: true, job: { def: defs[id] } } : { ok: false, code: "JOB_UNKNOWN" };
        },
      }),
    };
    const env = { TENANT_ID: "solo-sam", QYVR_ENV: "test", AGENT_BUCKET: asBucket(r2), LEDGER: ledgers.binding, JOB };
    const h = new ObjectHarness(ada.email, (ctx, e) => {
      migrateObject(ctx as DurableObjectState, "person");
      const p = Object.create(Person.prototype) as Person;
      for (const [k, v] of Object.entries({ ctx, env: e, name: ada.email })) Object.defineProperty(p, k, { value: v });
      return p;
    }, env);
    const person = () => h.instance;
    await asBucket(r2).put(`${personalSkillsPrefix(ada.email)}weekly-review/SKILL.md`, `---\nname: weekly-review\ndescription: Weekly review\n---\n${FACT}\n`);
    person();
    for (const id of ["harbor-watch", "tide-chart"]) h.rows("INSERT INTO job_index (id, noted_at) VALUES (?, ?)", id, T0);
    const memory = (person() as unknown as { memory: MemoryService }).memory;
    const wrote = await memory.memoryWrite({ target: "daily", text: FACT }, { requester: ada.email, setting: { scope: "personal" }, source: "chat:test", dedupe: "x1" });
    if (!wrote.ok) throw new Error(JSON.stringify(wrote));
    const minted = seedClaim(memory.mem, wrote as never, { kind: "event" }) as unknown as { claimId: string };
    const plan = planOf(await person().forgetPlan({ claimIds: [minted.claimId] }, ada.email));
    expect(plan.rederives).toEqual([
      { kind: "job", id: "harbor-watch", how: "exact", claims: [minted.claimId] },
      { kind: "skill", id: "weekly-review", how: "exact", claims: [minted.claimId] },
    ]);
    expect(inspected).toEqual([`${ada.email}:${ada.email}/harbor-watch`, `${ada.email}:${ada.email}/tide-chart`]);
  });
});
