// T-P6-10 (B-P6-10): the daily note is the chat's own lines, one dated file per day (delta 6). fletch's shape: the lines
// a turn wrote on day D are rendered to `memory/<D>.md` by the render timer, once; the hourly upkeep turns each line into
// a claim on that line and originates nothing; a reply on D+1 that names a fact from D cites `memory/<D>.md#L<n>`.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_FACT, replyOf, resolves, SAM_FACT } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const D = "2026-10-13";
export const NOTE = `memory/${D}.md`;
export const DAY = 86_400_000;
export const ASK = "When is the team meeting now?";

const dayLines = (w: P6World) => w.lines().filter((l) => l.citation.startsWith(`${NOTE}#L`));

export const task = defineTask<P6World>({
  id: "T-P6-10",
  cluster: "P6",
  clauses: ["B-P6-10"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 10, records: [`two daily lines written on ${D} from chat:c1`], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "clock", payload: { ms: String(DAY) } },
    { kind: "event", name: "render" },
    { kind: "event", name: "render" },
    { kind: "event", name: "upkeep" },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: [
    "the day's note is rendered once, with both lines at their citations",
    "the upkeep turns each line into one claim on that line",
    "the reply on D+1 cites the fact's line in the day's note",
  ],
  required_facts: ["a second timer fire changes nothing"],
  minefields: ["line_lost", "citation_drift", "duplicate_claims"],
  collateral: {
    journal: ["message:c1:3:you", "message:c1:4:agent", "turn:c1:2", "mail:c1:2:user", `claim:${NOTE}#L3:active`, `claim:${NOTE}#L4:active`],
    r2: [`person/sam%40solo-sam.example/${NOTE}`],
  },
  graders: [
    {
      name: "the day's note is rendered once, with both lines at their citations",
      kind: "end_state",
      check: async (w) => {
        const file = ((await w.file(NOTE)) ?? "").split("\n");
        return file[0] === `# ${D}` && dayLines(w).length === 2 && dayLines(w).every((l) => file[Number(l.citation.split("#L")[1]) - 1] === `- ${l.text}`) && (await resolves(w, `${NOTE}#L3`, PAT_FACT)) && (await resolves(w, `${NOTE}#L4`, SAM_FACT));
      },
    },
    { name: "the upkeep turns each line into one claim on that line", kind: "end_state", check: (w) => JSON.stringify(w.claims().map((c) => [c.citation, c.quote, c.status]).sort()) === JSON.stringify(dayLines(w).map((l) => [l.citation, l.text, "active"]).sort()) },
    { name: "the reply on D+1 cites the fact's line in the day's note", kind: "end_state", check: (w) => /Thursday/.test(replyOf(w)) && citationsIn(replyOf(w)).includes(`${NOTE}#L4`) },
    { name: "a second timer fire changes nothing", kind: "required_fact", check: (w) => w.renders().filter((p) => p === NOTE).length === 1 },
    { name: "line_lost", kind: "minefield", check: async (w) => dayLines(w).length < 2 || !(await Promise.all(dayLines(w).map((l) => resolves(w, l.citation, l.text)))).every(Boolean) },
    { name: "citation_drift", kind: "minefield", check: async (w) => !(await Promise.all(w.claims().map((c) => resolves(w, c.citation, c.quote)))).every(Boolean) },
    { name: "duplicate_claims", kind: "minefield", check: (w) => new Set(w.claims().map((c) => c.citation)).size !== w.claims().length || w.claims().length > dayLines(w).length },
  ],
  reference: "Muse's note is a per-chat run summary by a background worker (B-P6-10); fletch's note is the chat's own lines, rendered on the timer (M2.1 daily notes, delta 6).",
});

export default task;
