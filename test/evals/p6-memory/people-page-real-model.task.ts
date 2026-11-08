// T-P6-14 (B-P6-11): tier 2, three passing mentions of Pat Solo make no page; a stated relationship makes one, with the
// six sections and cited facts, and the index lists Pat. fletch writes a page through the Person's `upsertEntity`,
// which the chat reaches through `memory_write` target person since F44 (delta 7's seam; until then no model tool did,
// and F28 recorded the failure on a slot); `people-page-real-model.test.ts` runs it under the scripted fake.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { INDEX, PAGE, SECTIONS } from "./people-page-shape.task.ts";
import { type P6World, resolves } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const MENTIONS = ["Pat Solo sent over the draft this morning", "I'm meeting Pat Solo for lunch on Friday", "Pat Solo liked the new logo"];
export const STATED = "Pat Solo is my co-founder; we talk every Monday";

const pageAfter = (w: P6World, i: number) => w.after()[i]?.paths.includes(PAGE) ?? true;
const facts = (text: string) => (/## Facts\n([\s\S]*?)(?=\n## |$)/.exec(text)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- "));

export const task = defineTask<P6World>({
  id: "T-P6-14",
  cluster: "P6",
  // No clause names it (the contract's reference does): it repeats tier-1 tasks with the real model.
  clauses: [],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 14, records: ["chat:c1", "no people pages"], files: [], jobs: [] },
  turns: [...MENTIONS, STATED].map((text) => ({ kind: "prompt" as const, by: sam.email, text })),
  end_state: ["no page after the three mentions", "after the stated relationship the page has the six sections", "the index lists Pat with the relationship"],
  required_facts: ["every fact on the page carries a citation that resolves"],
  minefields: ["page_per_mention", "uncited_page_fact"],
  collateral: {},
  graders: [
    { name: "no page after the three mentions", kind: "end_state", check: (w) => !pageAfter(w, 0) && !pageAfter(w, 1) && !pageAfter(w, 2) },
    { name: "after the stated relationship the page has the six sections", kind: "end_state", check: async (w) => JSON.stringify([...((await w.file(PAGE)) ?? "").matchAll(/^## (.+)$/gm)].map((m) => m[1])) === JSON.stringify(SECTIONS) },
    { name: "the index lists Pat with the relationship", kind: "end_state", check: async (w) => /\[Pat Solo\]\(pat-solo\.md\).*co-?founder/i.test((await w.file(INDEX)) ?? "") },
    {
      name: "every fact on the page carries a citation that resolves",
      kind: "required_fact",
      check: async (w) => (await Promise.all(facts((await w.file(PAGE)) ?? "").map((l) => ((c) => (c ? resolves(w, c, "Pat") : Promise.resolve(false)))(/(\S+\.md#L\d+)/.exec(l)?.[1])))).every(Boolean),
    },
    { name: "page_per_mention", kind: "minefield", check: (w) => pageAfter(w, 0) || pageAfter(w, 1) || pageAfter(w, 2) },
    { name: "uncited_page_fact", kind: "minefield", check: async (w) => facts((await w.file(PAGE)) ?? "").some((l) => !/\S+\.md#L\d+/.test(l)) },
  ],
  reference: "Muse's pages for recurring people with a stated relationship, none for the fixtures (B-P6-11).",
});

export default task;
