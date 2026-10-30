// T-P6-05 (B-P6-06): a correction is a new line that names what it replaces; the hourly upkeep's claim on it
// supersedes the old one, so one claim is live, a search shows the old line only with its supersession marker, and
// memory_explain names what was replaced. fletch's shape: Muse rewrote `MEMORY.md#L28` in place; fletch keeps both lines
// and the chain between their claims (M2.1 supersession).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_CORRECTION, PAT_FACT, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const CORRECT = "actually Pat Solo prefers Markdown, not plain text";
export const ASK = "What document format does Pat Solo prefer?";
/** The correction's line as the scripted model writes it: the new claim and what it replaces. */
export const CORRECTION_LINE = `${PAT_CORRECTION} (replaces: ${PAT_FACT})`;

const oldClaim = (w: P6World) => w.claims().find((c) => c.quote === PAT_FACT);
const newClaim = (w: P6World) => w.claims().find((c) => c.quote === CORRECTION_LINE);
const liveOnFormat = (w: P6World) => w.claims().filter((c) => c.status === "active" && c.quote.startsWith("Pat Solo prefers"));

export const task = defineTask<P6World>({
  id: "T-P6-05",
  cluster: "P6",
  clauses: ["B-P6-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 5, records: ["the Pat line (plain text) with its claim, minted by the upkeep", "chat:c1", "chat:c2 (fresh)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: CORRECT },
    { kind: "event", name: "upkeep" },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: [
    "the new line names what it replaces",
    "the old claim is superseded by the new one, and a search shows its line only with the marker",
    "the recall gives Markdown with the new line's citation",
    "memory_explain on the new claim names the claim it replaced",
  ],
  required_facts: ["exactly one live claim on Pat's format"],
  minefields: ["two_live_claims", "old_value_recalled", "history_lost"],
  collateral: {
    journal: [
      "message:c1:3:you",
      "message:c1:4:agent",
      "turn:c1:2",
      "mail:c1:2:user",
      "message:c2:1:you",
      "message:c2:2:agent",
      "turn:c2:1",
      "mail:c2:1:user",
      "line:memory/2026-10-13.md#L4",
      "chunk:memory/2026-10-13.md#L4",
      "claim:memory/2026-10-13.md#L4:active",
      "claim:memory/2026-10-13.md#L3:superseded",
      "gone:claim:memory/2026-10-13.md#L3:active",
    ],
  },
  graders: [
    { name: "the new line names what it replaces", kind: "end_state", check: (w) => w.lines().some((l) => l.text.startsWith(PAT_CORRECTION) && l.text.includes(`replaces: ${PAT_FACT}`)) },
    {
      name: "the old claim is superseded by the new one, and a search shows its line only with the marker",
      kind: "end_state",
      check: async (w) => {
        const o = oldClaim(w);
        const n = newClaim(w);
        const hits = (await w.search(["Pat Solo plain text", "Pat Solo document format"])).hits.filter((h) => h.citation === o?.citation);
        return o?.status === "superseded" && n?.supersedes === o.id && hits.length > 0 && hits.every((h) => (h.marker ?? "").includes(`SUPERSEDED: claim ${o.id}`));
      },
    },
    { name: "the recall gives Markdown with the new line's citation", kind: "end_state", check: (w) => /\bMarkdown\b/.test(replyOf(w, "c2")) && citationsIn(replyOf(w, "c2")).includes(newClaim(w)?.citation ?? "-") },
    { name: "memory_explain on the new claim names the claim it replaced", kind: "end_state", check: async (w) => ((e) => e.ok && e.supersedes.length === 1 && e.supersedes[0] === oldClaim(w)?.id)(await w.explain(newClaim(w)?.id ?? "-")) },
    { name: "exactly one live claim on Pat's format", kind: "required_fact", check: (w) => liveOnFormat(w).length === 1 && liveOnFormat(w)[0]?.quote === CORRECTION_LINE },
    { name: "two_live_claims", kind: "minefield", check: (w) => liveOnFormat(w).length > 1 },
    // The old value named as current: "plain text" in the recall with no word that sets it aside.
    { name: "old_value_recalled", kind: "minefield", check: (w) => /plain text/i.test(replyOf(w, "c2")) && !/\b(replac|not|no longer|instead|correct|used to|earlier)/i.test(replyOf(w, "c2")) },
    { name: "history_lost", kind: "minefield", check: async (w) => !oldClaim(w) || !((e) => e.ok && e.supersededBy.includes(newClaim(w)?.id ?? "-"))(await w.explain(oldClaim(w)!.id)) },
  ],
  reference: "Muse rewrote `MEMORY.md#L28` in place with \"corrected 2026-10-30, replaces …\" (B-P6-06); fletch keeps the chain (M2.1 supersession, `test/workers/m2-memory.test.ts`).",
});

export default task;
