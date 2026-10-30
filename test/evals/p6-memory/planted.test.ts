// The P6 graders, planted (F27): each tier-1 task's minefields are run on a world where the fault happened, through
// the same harness and the production engine where the fault can be scripted (words before the write, a second call
// id, a reply with no citation, a refused edit called saved, an upkeep that supersedes nothing, a plan that reaches the
// Sam claim, a confirmation before the agent's, a page written before the relationships loop, a sub-agent gate that lets
// memory through), and on the one store the grader reads where it cannot (a transcript sent, a line lost, a chain cut).
import { afterEach, describe, expect, it } from "vitest";
import { subAgentGate } from "../../../packages/agent/src/subagents/run.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask } from "../../support/task.ts";
import correction, { CORRECTION_LINE } from "./correction-newest-wins.task.ts";
import daily from "./daily-note-shape.task.ts";
import forget from "./forget-two-phase.task.ts";
import { citeOf, type P6HarnessOptions, type P6Tier1World, p6Harness, replyFrom, sam, searchFor, upkeepSteps, writeDaily } from "./harness.ts";
import page, { PAGE } from "./people-page-shape.task.ts";
import recall, { SAID_IN_C1 as SAID_PAT } from "./recall-with-citation.task.ts";
import refused from "./refused-value.task.ts";
import remember from "./remember-on-ask.task.ts";
import { remember as rememberSteps, runs } from "./runs.ts";
import second, { SAID_IN_C1 } from "./second-chat-and-subagent.task.ts";
import { type P6World, PAT_CORRECTION, PAT_FACT, ZEROS } from "./world.ts";

const grader = (task: DefinedTask<P6World>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P6World) => g.check(w);
};

/** The task's turns played through a harness with `o`, and the world after them. */
async function played(task: DefinedTask<P6World>, o: P6HarnessOptions, turns = task.turns) {
  const h = p6Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = await h.setup(rng, task);
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** `w` with one reading replaced: the store the grader reads, as it would be had the fault happened. */
const faulted = (w: P6World, over: Partial<P6World>): P6World => Object.assign(Object.create(w) as P6World, over);
const last = (r: string[]) => r.at(-1) ?? "";
const searched = (r: string[]) => r.find((t) => / results for: /.test(t)) ?? "";

describe("[F27] the P6 graders, planted", () => {
  const honestGate = subAgentGate.call;
  afterEach(() => {
    subAgentGate.call = honestGate;
  });

  it("T-P6-01: saved before the write, a second call id, an uncited save and a refused edit called saved each fire", async () => {
    const one = remember.turns.slice(0, 1);
    const early = await played(remember, { script: [{ ...writeDaily("call_pat", PAT_FACT), text: "Saved." }, replyFrom((r) => `Done (${citeOf(last(r))}).`)] }, one);
    expect(await grader(remember, "saved_before_write")(early)).toBe(true);
    const twice = await played(remember, { script: [writeDaily("call_pat", PAT_FACT), replyFrom(() => "Noted."), writeDaily("call_pat_again", PAT_FACT), replyFrom(() => "Noted.")] }, remember.turns.slice(0, 2));
    expect(await grader(remember, "double_line")(twice)).toBe(true);
    const bare = await played(remember, { script: [writeDaily("call_pat", PAT_FACT), { text: "Saved." }] }, one);
    expect(await grader(remember, "uncited_claim")(bare)).toBe(true);
    const edit = { toolCall: { id: "call_edit", name: "memory_write", arguments: { target: "memory", sha256: "0".repeat(64), edits: [{ op: "insert", line: 4, text: `- ${PAT_FACT}` }] } } };
    const lied = await played(remember, { script: [edit, { text: "Saved to MEMORY.md." }] }, one);
    expect(await grader(remember, "refused_as_saved")(lied)).toBe(true);
  });

  it("T-P6-02: c1's words sent to c2, a reply with no citation and a no-record answer over a live line each fire", async () => {
    const o = runs["T-P6-02"]!();
    const honest = await played(recall, o);
    expect(await grader(recall, "transcript_read")(faulted(honest, { sentIn: (c) => [...honest.sentIn(c), SAID_PAT] }))).toBe(true);
    const bare = await played(recall, { ...o, script: [...o.script.slice(0, -1), { text: `From memory: ${PAT_FACT}.` }] });
    expect(await grader(recall, "no_citation")(bare)).toBe(true);
    const stale = await played(recall, { ...o, script: [...o.script.slice(0, -1), { text: "I don't know anything about Pat Solo." }] });
    expect(await grader(recall, "stale_absence")(stale)).toBe(true);
  });

  it("T-P6-05: an upkeep that supersedes nothing leaves two live claims; the old value recalled and a cut chain fire", async () => {
    const o = runs["T-P6-05"]!();
    // The second upkeep answered without a supersession: both claims stay live.
    const flat = await played(correction, {
      ...o,
      script: [...rememberSteps, ...upkeepSteps(), writeDaily("call_fix", CORRECTION_LINE), replyFrom((r) => `Corrected: ${PAT_CORRECTION} (${citeOf(last(r))}).`), ...upkeepSteps(), searchFor("call_s", "Pat Solo document format", "Pat Solo prefers"), replyFrom((r) => `Pat Solo prefers Markdown (${citeOf(searched(r), "Markdown")}).`)],
    });
    expect(await grader(correction, "two_live_claims")(flat)).toBe(true);
    const old = await played(correction, { ...o, script: [...o.script.slice(0, -1), replyFrom((r) => `Pat Solo prefers plain text (${citeOf(searched(r))}).`)] });
    expect(await grader(correction, "old_value_recalled")(old)).toBe(true);
    const honest = await played(correction, o);
    expect(await grader(correction, "history_lost")(honest)).toBe(false);
    const cut = faulted(honest, { explain: async (id) => ((e) => (e.ok ? { ...e, supersededBy: [] } : e))(await honest.explain(id)) });
    expect(await grader(correction, "history_lost")(cut)).toBe(true);
  });

  it("T-P6-06: the number in a store, in the reply or in a transcript hit, and the location dropped, each fire", async () => {
    const o = runs["T-P6-06"]!();
    const honest = await played(refused, o);
    const kept = faulted(honest, { lines: () => [...honest.lines(), { citation: "memory/2026-10-13.md#L9", text: `passport ${ZEROS}`, source: "chat:c1", writer: "agent" }] });
    expect(await grader(refused, "number_in_memory")(kept)).toBe(true);
    const said = await played(refused, { script: [writeDaily("call_loc", "Sam Solo's passport is in the blue folder."), { text: `Saved; the number ${ZEROS} too.` }] });
    expect(await grader(refused, "number_in_reply")(said)).toBe(true);
    const dropped = await played(refused, { script: [{ text: "I can't keep that." }] });
    expect(await grader(refused, "location_refused")(dropped)).toBe(true);
    const transcript = faulted(honest, { search: async (q) => ((r) => ({ ...r, hits: [...r.hits, { citation: "chat:c1#3", text: "my passport", marker: null, claims: [], match: "keyword" }] }))(await honest.search(q)) });
    expect(await grader(refused, "number_in_search")(transcript)).toBe(true);
  });

  it("T-P6-07: Sam's confirmation before the agent's, an accepted agent, a plan that reaches the Sam claim and no confirmation each fire", async () => {
    const o = runs["T-P6-07"]!();
    const [ask, plan, agent, pat, sam, render, recallTurn] = forget.turns;
    const early = await played(forget, o, [ask!, plan!, sam!, agent!, pat!, render!, recallTurn!]);
    expect(await grader(forget, "ran_on_ask")(early)).toBe(true);
    const honest = await played(forget, o);
    expect(await grader(forget, "model_confirmed")(faulted(honest, { confirms: () => honest.confirms().map((c) => (c.as === "agent" ? { ...c, ok: true, code: null } : c)) }))).toBe(true);
    const wide = await played(forget, o, [ask!, { kind: "event", name: "forget_plan", payload: { claim: "Solo" } }, sam!, render!]);
    expect(await grader(forget, "over_reach")(wide)).toBe(true);
    const unconfirmed = await played(forget, o, [ask!, plan!, render!]);
    expect(await grader(forget, "index_stale")(unconfirmed)).toBe(true);
    expect(await grader(forget, "tombstone_missing")(unconfirmed)).toBe(true);
  });

  it("T-P6-08: c1's words sent to c2, a gate that lets memory through, and an uncited reply each fire", async () => {
    const o = runs["T-P6-08"]!();
    const honest = await played(second, o);
    expect(await grader(second, "subagent_read_memory")(honest)).toBe(false);
    expect(await grader(second, "transcript_read")(faulted(honest, { sentIn: (c) => [...honest.sentIn(c), SAID_IN_C1] }))).toBe(true);
    // The M7.2 gate: memory reads were plain observations, so they ran.
    subAgentGate.call = async (spec, _id, _args, run) => (spec.kind === "observation" && spec.subject === undefined && !spec.mutates ? run() : honestGate(spec, _id, _args, run));
    const leaked = await played(second, o);
    expect(await grader(second, "subagent_read_memory")(leaked)).toBe(true);
    subAgentGate.call = honestGate;
    const bare = await played(second, { ...o, script: o.script.map((s, i) => (i === o.script.length - 3 ? { text: "Pat Solo prefers plain text; Sam Solo moved the meeting." } : s)) });
    expect(await grader(second, "uncited_claim")(bare)).toBe(true);
  });

  it("T-P6-10: a lost line, a claim off its line and a second claim on one line each fire", async () => {
    const honest = await played(daily, runs["T-P6-10"]!());
    expect(await grader(daily, "line_lost")(faulted(honest, { lines: () => honest.lines().slice(1) }))).toBe(true);
    expect(await grader(daily, "citation_drift")(faulted(honest, { claims: () => honest.claims().map((c) => ({ ...c, citation: c.citation.replace(/#L(\d+)$/, (_m, n) => `#L${Number(n) + 5}`) })) }))).toBe(true);
    expect(await grader(daily, "duplicate_claims")(faulted(honest, { claims: () => [...honest.claims(), { ...honest.claims()[0]!, id: "dup" }] }))).toBe(true);
  });

  it("T-P6-11: a page written before the relationships loop, an uncited fact and a hoisted page each fire", async () => {
    const o = runs["T-P6-11"]!();
    const [mention, relationships, upsert, thanks] = page.turns;
    const eager = await played(page, o, [mention!, upsert!, relationships!, thanks!]);
    expect(await grader(page, "page_per_mention")(eager)).toBe(true);
    const honest = await played(page, o);
    const uncited = faulted(honest, { file: async (p) => ((t) => (p === PAGE && t ? t.replace("## Facts\n", "## Facts\n- Pat likes long walks\n") : t))(await honest.file(p)) });
    expect(await grader(page, "uncited_page_fact")(uncited)).toBe(true);
    expect(await grader(page, "page_hoisted")(faulted(honest, { context: (c) => `${honest.context(c)}\n## The relationship\n` }))).toBe(true);
  });

  it("MEMORY_VALUE_REFUSED holds on every write target, and a line refused for its shape keeps that code", async () => {
    const w = (await played(refused, runs["T-P6-06"]!())) as unknown as P6Tier1World;
    const ctx = { requester: sam.email, setting: { scope: "personal" as const }, source: "chat:c1", dedupe: "planted" };
    const number = `Sam Solo's passport number is ${ZEROS}`;
    for (const input of [
      { target: "daily" as const, text: number },
      { target: "memory" as const, sha256: "0".repeat(64), edits: [{ op: "insert" as const, line: 4, text: `- ${number}` }] },
      { target: "team" as const, team: "core", text: number },
    ]) expect(await w.svc.memoryWrite(input, ctx)).toMatchObject({ ok: false, code: "MEMORY_VALUE_REFUSED" });
    expect(await w.svc.memoryWrite({ target: "daily", text: "x".repeat(1001) }, ctx)).toMatchObject({ ok: false, code: "MEMORY_TOO_LONG" });
    // MEMORY.md has no line cap, so an over-long edit is still read for the value.
    const long = { target: "memory" as const, sha256: "0".repeat(64), edits: [{ op: "insert" as const, line: 4, text: `- ${number} ${"x".repeat(1000)}` }] };
    expect(await w.svc.memoryWrite(long, ctx)).toMatchObject({ ok: false, code: "MEMORY_VALUE_REFUSED" });
  });

  it("every planted world's honest run holds every minefield", async () => {
    for (const task of [remember, recall, correction, refused, forget, second, daily, page]) {
      const w = await played(task, runs[task.id]!());
      for (const g of task.graders.filter((x) => x.kind === "minefield")) expect([task.id, g.name, await g.check(w)]).toEqual([task.id, g.name, false]);
    }
  });
});
