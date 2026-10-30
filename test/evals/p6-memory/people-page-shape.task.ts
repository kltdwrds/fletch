// T-P6-11 (B-P6-11): a people page is written on a stated relationship, not from a mention (delta 7). fletch's shape:
// a line that mentions Pat Solo once makes no page, and the relationships loop re-ranks existing pages only, so it makes
// none either; `upsertEntity` on the Person writes `memory/people/pat-solo.md` with fletch's six sections
// (`PAGE_SECTIONS`, in fletch's order: Strengthening before Open threads, where Muse lists them the other way) and
// renders `memory/people/INDEX.md`; the next turn's context hoists the index and not the page.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { P6World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const MENTION = "Pat Solo sent over the draft this morning";
export const PAGE = "memory/people/pat-solo.md";
export const INDEX = "memory/people/INDEX.md";
export const RELATIONSHIP = "Sam's co-founder; they talk every Monday";
export const SECTIONS = ["Facts", "History", "The relationship", "In common", "Strengthening", "Open threads"];

const pageAfter = (w: P6World, turn: string) => w.after().find((a) => a.turn === turn)?.paths.includes(PAGE) ?? true;
const pageFacts = (text: string) => (/## Facts\n([\s\S]*?)(?=\n## |$)/.exec(text)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- "));

export const task = defineTask<P6World>({
  id: "T-P6-11",
  cluster: "P6",
  clauses: ["B-P6-11"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 11, records: ["chat:c1", "no people pages"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: `note that ${MENTION}` },
    { kind: "event", name: "relationships" },
    { kind: "event", name: "upsert_entity", payload: { name: "Pat Solo", summary: RELATIONSHIP, rank: "5" } },
    { kind: "prompt", by: sam.email, text: "thanks" },
  ],
  end_state: [
    "no page after the one mention and the relationships loop",
    "after the upsert the page has the six sections in order",
    "the index lists Pat with the one-line relationship",
    "the next turn's context hoists the index and not the page",
  ],
  required_facts: ["every fact on the page carries a citation"],
  minefields: ["page_per_mention", "uncited_page_fact", "page_hoisted"],
  collateral: {
    journal: [
      "message:c1:1:you",
      "message:c1:2:agent",
      "message:c1:3:you",
      "message:c1:4:agent",
      "turn:c1:1",
      "turn:c1:2",
      "mail:c1:1:user",
      "mail:c1:2:user",
      "line:memory/2026-10-13.md#L3",
      "chunk:memory/2026-10-13.md#L3",
      // The page and the index, each chunk-indexed by line as every home file is.
      ...[1, 3, 5].map((n) => `chunk:${INDEX}#L${n}`),
      ...[1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 15, 17, 19, 21].map((n) => `chunk:${PAGE}#L${n}`),
    ],
    r2: [`person/sam%40solo-sam.example/${INDEX}`, `person/sam%40solo-sam.example/${PAGE}`],
  },
  graders: [
    { name: "no page after the one mention and the relationships loop", kind: "end_state", check: (w) => !pageAfter(w, "prompt:c1") && !pageAfter(w, "event:relationships") && !w.after()[1]?.paths.some((p) => p.startsWith("memory/people/")) },
    {
      name: "after the upsert the page has the six sections in order",
      kind: "end_state",
      check: async (w) => ((t) => t.includes("\n# Pat Solo\n") && JSON.stringify([...t.matchAll(/^## (.+)$/gm)].map((m) => m[1])) === JSON.stringify(SECTIONS))((await w.file(PAGE)) ?? ""),
    },
    { name: "the index lists Pat with the one-line relationship", kind: "end_state", check: async (w) => ((await w.file(INDEX)) ?? "").includes(`[Pat Solo](pat-solo.md) (rank 5): ${RELATIONSHIP}`) },
    { name: "the next turn's context hoists the index and not the page", kind: "end_state", check: (w) => w.context("c1").includes(`[Pat Solo](pat-solo.md) (rank 5): ${RELATIONSHIP}`) && !w.context("c1").includes("## The relationship") },
    { name: "every fact on the page carries a citation", kind: "required_fact", check: async (w) => pageFacts((await w.file(PAGE)) ?? "").every((l) => /\S+\.md#L\d+/.test(l)) },
    { name: "page_per_mention", kind: "minefield", check: (w) => pageAfter(w, "prompt:c1") || pageAfter(w, "event:relationships") },
    { name: "uncited_page_fact", kind: "minefield", check: async (w) => pageFacts((await w.file(PAGE)) ?? "").some((l) => !/\S+\.md#L\d+/.test(l)) },
    { name: "page_hoisted", kind: "minefield", check: (w) => w.context("c1").includes("## The relationship") },
  ],
  reference: "Muse's 55 pages, six sections, bare citations, pages only for recurring people (B-P6-11).",
});

export default task;
