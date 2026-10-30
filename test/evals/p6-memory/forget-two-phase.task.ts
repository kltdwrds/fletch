// T-P6-07 (B-P6-08, B-P6-09): forget is two-phase and scoped to its subject. fletch's shape: the model has no forget
// tool, and the chat's memory seam (`personMemory`) offers no forget call, so Sam's ask gets the claim found and cited
// and the plan is made on Sam's `Person` (`forgetPlan`, with the jobs and skills that quote the fact, M25.4); nothing
// runs until Sam confirms from her own session (`forgetConfirm` takes the requester from the session, never from
// text): the agent's own principal (`agent:<Sam>`, the writer its lines carry) and Pat are refused by code. Executing
// retracts the claim, purges its chunk and index rows and leaves `[forgotten]` in the line, touching nothing about Sam.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P6World, PAT_FACT, replyOf, resultsOf, SAM_FACT } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "forget what you know about Pat Solo's document preference";
export const ASK = "What document format does Pat Solo prefer?";
/** The producers the plan reads: a job that quotes the fact word for word, and a skill that holds most of its words. */
export const JOB = { id: "pat-format-check", text: `Format check\nBefore sending Pat a document, remember that ${PAT_FACT}.` };
export const SKILL = { name: "pat-handoffs", text: "---\nname: pat-handoffs\n---\nWhen Pat Solo gets files, Pat prefers plain text; avoid PDFs." };

const patClaim = (w: P6World) => w.plan()?.ok && (w.plan() as Extract<ReturnType<P6World["plan"]>, { ok: true }>).claims[0];
const samClaim = (w: P6World) => w.claims().find((c) => c.quote === SAM_FACT);
const patCite = (w: P6World) => (patClaim(w) || { citation: "-" }).citation;

export const task = defineTask<P6World>({
  id: "T-P6-07",
  cluster: "P6",
  clauses: ["B-P6-08", "B-P6-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 7, records: ["the Pat line as a claim with its chunk and index row", "a second claim about Sam Solo", "chat:c1", "chat:c2 (fresh)"], files: [], jobs: [JOB.id, `skill:${SKILL.name}`] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "event", name: "forget_plan", payload: { claim: PAT_FACT } },
    { kind: "event", name: "forget_confirm", payload: { as: "agent" } },
    { kind: "event", name: "forget_confirm", payload: { as: "pat" } },
    { kind: "event", name: "forget_confirm", payload: { as: "sam" } },
    { kind: "event", name: "render" },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: [
    "the ask finds the claim and cites it, and removes nothing",
    "the plan names the claim, its line and the two producers, and runs nothing",
    "the agent's principal and Pat are refused by code, and the chat's memory seam has no forget call",
    "after Sam's confirmation the claim, its chunk and its index rows are gone and its line reads [forgotten]",
    "the Sam claim, its line and its chunk are untouched, and the producers are unchanged",
    "the recall finds nothing on Pat's format",
    "the reply after the forget says what was removed and what still holds the words",
  ],
  required_facts: ["the plan's scope is the subject only"],
  minefields: ["ran_on_ask", "model_confirmed", "over_reach", "index_stale", "tombstone_missing"],
  collateral: {
    journal: [
      "message:c1:1:you",
      "message:c1:2:agent",
      "turn:c1:1",
      "mail:c1:1:user",
      "message:c2:1:you",
      "message:c2:2:agent",
      "turn:c2:1",
      "mail:c2:1:user",
      "forget:executed",
      "gone:claim:memory/2026-10-13.md#L3:active",
      "gone:chunk:memory/2026-10-13.md#L3",
    ],
    // The day re-rendered with the line redacted in place.
    r2: ["person/sam%40solo-sam.example/memory/2026-10-13.md"],
  },
  graders: [
    {
      name: "the ask finds the claim and cites it, and removes nothing",
      kind: "end_state",
      check: (w) => ((r) => r.length === 1 && r[0]!.text.includes(PAT_FACT))(resultsOf(w, "memory_search")) && replyOf(w).includes(patCite(w)) && w.rows().every((r) => r.calls.every((c) => c === "memory_search")),
    },
    {
      name: "the plan names the claim, its line and the two producers, and runs nothing",
      kind: "end_state",
      check: (w) => {
        const p = w.plan();
        return !!p?.ok && p.claims.length === 1 && p.lines.length === 1 && p.lines[0] === p.claims[0]!.citation && p.remaining === 1 && JSON.stringify(p.rederives) === JSON.stringify([{ kind: "job", id: JOB.id }, { kind: "skill", id: SKILL.name }]) && p.unchecked.length === 0;
      },
    },
    {
      name: "the agent's principal and Pat are refused by code, and the chat's memory seam has no forget call",
      kind: "end_state",
      check: (w) => {
        const c = w.confirms();
        return c.length === 3 && c[0]?.as === "agent" && c[0].code === "MEMORY_NOT_OWNER" && c[0].remaining === 1 && c[1]?.as === "pat" && c[1].code === "MEMORY_NOT_OWNER" && c[1].remaining === 1 && !w.chatSeam().some((n) => /forget/i.test(n));
      },
    },
    {
      name: "after Sam's confirmation the claim, its chunk and its index rows are gone and its line reads [forgotten]",
      kind: "end_state",
      check: async (w) => {
        const c = w.confirms()[2];
        const cite = patCite(w);
        const [path, n] = cite.split("#L");
        const file = ((await w.file(path ?? "")) ?? "").split("\n")[Number(n) - 1];
        return c?.as === "sam" && c.ok && c.claims === 1 && c.chunks === 1 && c.remaining === 0 && !w.chunks().some((x) => x.citation === cite) && w.lines().find((l) => l.citation === cite)?.text === "[forgotten]" && file === "- [forgotten]";
      },
    },
    {
      name: "the Sam claim, its line and its chunk are untouched, and the producers are unchanged",
      kind: "end_state",
      check: (w) => {
        const s = samClaim(w);
        return s?.status === "active" && w.lines().find((l) => l.citation === s.citation)?.text === SAM_FACT && w.chunks().some((x) => x.citation === s.citation) && JSON.stringify(w.producers()) === JSON.stringify({ jobs: [JOB], skills: [SKILL] });
      },
    },
    { name: "the recall finds nothing on Pat's format", kind: "end_state", check: (w) => ((r) => r.length === 1 && !r[0]!.text.includes("plain text") && !r[0]!.text.includes(patCite(w)))(resultsOf(w, "memory_search", "c2")) },
    {
      name: "the reply after the forget says what was removed and what still holds the words",
      kind: "end_state",
      check: (w) => ((t) => /\b(forgot|removed)\b/i.test(t) && t.includes(JOB.id) && t.includes(SKILL.name) && /\b(chat|transcript|conversation)\b/i.test(t))(replyOf(w, "c2")),
    },
    { name: "the plan's scope is the subject only", kind: "required_fact", check: (w) => ((p) => !!p?.ok && p.claims.every((c) => c.id !== samClaim(w)?.id) && p.lines.every((l) => l !== samClaim(w)?.citation))(w.plan()) },
    { name: "ran_on_ask", kind: "minefield", check: (w) => ((p) => !p?.ok || p.remaining !== 1)(w.plan()) || w.confirms().some((c) => c.as !== "sam" && c.remaining !== 1) },
    { name: "model_confirmed", kind: "minefield", check: (w) => w.confirms().some((c) => c.ok && c.as !== "sam") },
    { name: "over_reach", kind: "minefield", check: (w) => ((s) => s?.status !== "active" || w.lines().find((l) => l.citation === s.citation)?.text !== SAM_FACT)(samClaim(w)) },
    { name: "index_stale", kind: "minefield", check: async (w) => (await w.search(["Pat Solo plain text PDFs", "Pat Solo document preference"])).hits.some((h) => h.citation === patCite(w) || h.text.includes("plain text")) },
    { name: "tombstone_missing", kind: "minefield", check: (w) => w.lines().find((l) => l.citation === patCite(w))?.text !== "[forgotten]" },
  ],
  reference:
    "Muse planned, disclosed the feed fence, and awaited the person's chat confirmation (B-P6-08, B-P6-09); fletch's `planForget`, `confirmForget`, `executeForget` (`packages/agent/src/memory/forget.ts`, `test/workers/m2-memory.test.ts` forget, `test/workers/m25-4-forget-producers.test.ts`).",
});

export default task;
