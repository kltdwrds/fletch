// The tier-1 runs of the P6 tasks (F27): each task's script, seeds and options for `p6Harness`, shared by its `.test.ts`
// and by `planted.test.ts`, which plays the same runs with the fault planted. One fake script serves the seed's turns,
// the task's turns, the upkeep's two calls and the sub-agent, in the order they run.
import type { FakeStep } from "../../support/fake-model.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask } from "../../support/task.ts";
import { CORRECTION_LINE } from "./correction-newest-wins.task.ts";
import { JOB, SKILL } from "./forget-two-phase.task.ts";
import { callFrom, citeOf, type P6HarnessOptions, type P6Tier1World, p6Harness, replyFrom, sam, searchFor, upkeepSteps, writeDaily } from "./harness.ts";
import { MENTION } from "./people-page-shape.task.ts";
import { SAID_IN_C1 as SAID_PAT } from "./recall-with-citation.task.ts";
import { SAID_IN_C1 } from "./second-chat-and-subagent.task.ts";
import type { P6World } from "./world.ts";
import { PAT_CORRECTION, PAT_FACT, SAM_FACT } from "./world.ts";

const last = (r: string[]) => r.at(-1) ?? "";
const searched = (r: string[]) => r.find((t) => / results for: /.test(t)) ?? "";
/** A memory_get of the line the turn's search cited for `needle`. */
const readCited = (id: string, needle: string): FakeStep =>
  callFrom((r) => {
    const [path, line] = citeOf(searched(r), needle).split("#L");
    return { id, name: "memory_get", arguments: { path: path ?? "", from: Number(line), limit: 1 } };
  });

/** A scripted `memory_write` of a person page on a stated relationship (F44). */
export const notePerson = (id: string, name: string, relationship: string): FakeStep => ({ toolCall: { id, name: "memory_write", arguments: { target: "person", name, relationship } } });

/** T-P6-01's first turn: the write, then the reply quoting the citation the tool returned. */
export const remember: FakeStep[] = [writeDaily("call_pat", PAT_FACT), replyFrom((r) => `Saved: ${PAT_FACT} (${citeOf(last(r))}).`)];
/** Both facts said in c1 and written, as T-P6-08 and T-P6-10 find them. */
const rememberBoth: FakeStep[] = [writeDaily("call_pat", PAT_FACT), writeDaily("call_sam", SAM_FACT), { text: "Saved both." }];

export const LOCATION = "Sam Solo's passport is in the blue folder; its number was deliberately not recorded.";
const refusedReply = replyFrom((r) => `Saved where your passport is kept, the blue folder (${citeOf(last(r))}). I did not record the number: memory never keeps a government ID number.`);
/** T-P6-06's planted second script: the number written first, refused at memory_write, then the location. */
export const triesTheNumber: FakeStep[] = [writeDaily("call_number", "Sam Solo's passport number is 0000 0000 0000 0000, kept in the blue folder."), writeDaily("call_loc", LOCATION), refusedReply];

const supersedeFormat = upkeepSteps({ supersede: (line, active) => (line.startsWith(PAT_CORRECTION) ? active.find((a) => a.quote === PAT_FACT)?.id : undefined) });

export const runs: Record<string, () => P6HarnessOptions> = {
  "T-P6-01": () => ({
    script: [
      ...remember,
      // The same step replayed, as a resumed turn would: the call's id is the line's key.
      writeDaily("call_pat", PAT_FACT),
      replyFrom((r) => `Already saved: ${PAT_FACT} (${citeOf(last(r))}).`),
      { toolCall: { id: "call_edit", name: "memory_write", arguments: { target: "memory", sha256: "0".repeat(64), edits: [{ op: "insert", line: 4, text: `- ${PAT_FACT}` }] } } },
      replyFrom((r) => `MEMORY.md was not changed: the edit was refused (${/MEMORY_[A-Z_]+/.exec(last(r))?.[0] ?? "no code"}). The daily line still holds it.`),
    ],
  }),
  "T-P6-02": () => ({
    vectorDown: true,
    chats: ["c2"],
    seed: (w: P6Tier1World) => w.say(SAID_PAT),
    script: [...remember, searchFor("call_s", "Pat Solo", "Pat Solo preferences"), readCited("call_g", PAT_FACT), replyFrom((r) => `From memory: ${PAT_FACT} (${citeOf(searched(r), PAT_FACT)}).`)],
  }),
  "T-P6-05": () => ({
    chats: ["c1", "c2"],
    seed: async (w: P6Tier1World) => {
      await w.say(SAID_PAT);
      await w.loops.upkeep(0);
    },
    script: [
      ...remember,
      ...upkeepSteps(),
      writeDaily("call_fix", CORRECTION_LINE),
      replyFrom((r) => `Corrected: ${PAT_CORRECTION} (${citeOf(last(r))}).`),
      ...supersedeFormat,
      searchFor("call_s", "Pat Solo document format", "Pat Solo prefers"),
      replyFrom((r) => `Pat Solo prefers Markdown (${citeOf(searched(r), "Markdown")}).`),
    ],
  }),
  "T-P6-06": () => ({ script: [writeDaily("call_loc", LOCATION), refusedReply] }),
  "T-P6-07": () => ({
    chats: ["c1", "c2"],
    producers: { jobs: [JOB], skills: [SKILL] },
    seed: async (w: P6Tier1World) => {
      for (const [id, text] of [["seed_pat", PAT_FACT], ["seed_sam", SAM_FACT]] as const) {
        const r = await w.svc.memoryWrite({ target: "daily", text }, { requester: sam.email, setting: { scope: "personal" }, source: `chat:${w.harness("c1").name}`, dedupe: id });
        if (!r.ok) throw new Error(`P6_SEED: ${r.code}`);
      }
      await w.loops.upkeep(0);
    },
    script: [
      ...upkeepSteps({ kind: "preference" }),
      searchFor("call_s", "Pat Solo document preference", "Pat Solo plain text"),
      replyFrom((r) => `I found it: ${PAT_FACT} (${citeOf(searched(r), PAT_FACT)}). I can't remove memory myself; the forget plan is yours to confirm.`),
      searchFor("call_s2", "Pat Solo document format", "Pat Solo prefers"),
      replyFrom(() => `I have no record of Pat Solo's document format now: I removed the claim and its line now reads [forgotten]. The job ${JOB.id} and the skill ${SKILL.name} still hold the words, and so does the chat where you said it.`),
    ],
  }),
  "T-P6-08": () => ({
    chats: ["c2"],
    seed: async (w: P6Tier1World) => {
      await w.say(SAID_IN_C1);
      await w.loops.upkeep(0);
    },
    script: [
      ...rememberBoth,
      ...upkeepSteps({ kind: "fact" }),
      searchFor("call_s", "Pat Solo", "Sam Solo"),
      replyFrom((r) => `${PAT_FACT} (${citeOf(searched(r), PAT_FACT)}); ${SAM_FACT} (${citeOf(searched(r), SAM_FACT)}).`),
      // The sub-agent: it reaches for memory, is refused, and hands off what it could not establish.
      searchFor("call_sub", "Pat Solo", "Sam Solo"),
      { text: "I could not read the person's memory (SUBAGENT_MEMORY_REFUSED), so I found nothing about either person." },
    ],
  }),
  "T-P6-10": () => ({
    seed: (w: P6Tier1World) => w.say(SAID_IN_C1),
    script: [...rememberBoth, ...upkeepSteps({ kind: "fact" }), searchFor("call_s", "team meeting", "meeting day"), replyFrom((r) => `Thursdays (${citeOf(searched(r), "Thursdays")}).`)],
  }),
  "T-P6-11": () => ({ script: [writeDaily("call_m", MENTION), replyFrom((r) => `Saved (${citeOf(last(r))}).`), { text: "You're welcome." }] }),
};

/** Sam's forget of the Pat claim, planned and confirmed on her `Person` (T-P6-12's setup is T-P6-07 after it). */
async function forgotten(w: P6Tier1World): Promise<void> {
  await runs["T-P6-07"]!().seed!(w);
  const ids = w.claims().filter((c) => c.quote === PAT_FACT).map((c) => c.id);
  const plan = await w.svc.forgetPlan({ claimIds: ids }, sam.email, { jobs: async () => [JOB], skills: async () => [SKILL] });
  if (!plan.ok) throw new Error(`P6_SEED_PLAN: ${plan.code}`);
  const done = await w.svc.forgetConfirm(plan.planId, sam.email);
  if (!done.ok) throw new Error(`P6_SEED_CONFIRM: ${done.code}`);
}

/** The tier-2 tasks' scripted runs (F27): what a model that keeps every rule would do, so each file loads and runs here before F28 runs it on a slot. */
export const scripted: Record<string, () => P6HarnessOptions> = {
  "T-P6-03": () => ({
    seed: (w: P6Tier1World) => w.say(SAID_PAT),
    script: [
      ...remember,
      searchFor("call_s", "Pat Solo favourite colour", "Pat Solo colour"),
      replyFrom((r) => `I don't know: there's no record of Pat Solo's favourite colour. The one thing I have is that ${PAT_FACT} (${citeOf(searched(r), PAT_FACT)}).`),
    ],
  }),
  "T-P6-04": () => ({ script: [writeDaily("call_sam", SAM_FACT), replyFrom((r) => `Saved: ${SAM_FACT} (${citeOf(last(r))}).`)] }),
  "T-P6-09": () => ({
    script: [
      ...remember,
      searchFor("call_s", "Pat Solo", "Pat Solo preferences"),
      replyFrom((r) => `${PAT_FACT} (${citeOf(searched(r), PAT_FACT)}).`),
      writeDaily("call_fix", CORRECTION_LINE),
      replyFrom((r) => `Corrected: ${PAT_CORRECTION} (${citeOf(last(r))}).`),
      searchFor("call_s2", "Pat Solo", "Pat Solo preferences"),
      replyFrom((r) => `Pat Solo prefers Markdown (${citeOf(r.findLast((t) => / results for: /.test(t)) ?? "", "Markdown")}), which replaces plain text.`),
    ],
  }),
  "T-P6-12": () => ({
    seed: forgotten,
    script: [
      ...upkeepSteps({ kind: "preference" }),
      { text: `I removed the claim, its line (it now reads [forgotten]) and its index rows. It isn't gone everywhere: this chat's transcript still holds your words, and the job ${JOB.id} and the skill ${SKILL.name} still quote it; I didn't change them.` },
    ],
  }),
  "T-P6-13": () => runs["T-P6-06"]!(),
  // F44: the stated relationship is one memory_write with target person (delta 7's seam), which saves the line and
  // writes Pat's page citing it; the reply names both.
  "T-P6-14": () => ({
    script: [{ text: "Noted." }, { text: "Noted." }, { text: "Noted." }, notePerson("call_rel", "Pat Solo", "co-founder; we talk every Monday"), replyFrom((r) => `Saved that Pat Solo is your co-founder (${citeOf(last(r))}) and wrote Pat's page, memory/people/pat-solo.md.`)],
  }),
};

/** Plays a task's turns through `p6Harness(o)` and answers each grader: `true` for a grader that held (a minefield that did not happen). */
export async function graded(task: DefinedTask<P6World>, o: P6HarnessOptions): Promise<Record<string, boolean>> {
  const h = p6Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = await h.setup(rng, task);
  for (const t of task.turns) await h.play(world, t, rng);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
