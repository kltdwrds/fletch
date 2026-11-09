// The shape every P16 task file shares (F80): its lists of end states, required facts and minefields are its graders'
// names by kind, its cluster P16 and its collateral none. Pure, as `world.ts` is.
import people from "../../fixtures/people.json" with { type: "json" };
import { type DefinedTask, defineTask, type Grader, type Turn } from "../../support/task.ts";
import type { P16World } from "./world.ts";

export const sam = people.people.find((p) => p.id === "sam-solo")!;
/** Sam's message in `c1`. */
export const says = (text: string): Turn => ({ kind: "prompt", by: sam.email, text });

export function p16Task<W extends P16World = P16World>(t: { id: string; clauses: string[]; priority: "must-have" | "nice-to-have"; tier: 1 | 2; seed: number; records: string[]; jobs?: string[]; turns: Turn[]; graders: Grader<W>[]; reference: string }): DefinedTask<W> {
  const of = (k: Grader<W>["kind"]) => t.graders.filter((g) => g.kind === k).map((g) => g.name);
  return defineTask<W>({
    id: t.id,
    cluster: "P16",
    clauses: t.clauses,
    priority: t.priority,
    tier: t.tier,
    setup: { seed: t.seed, records: t.records, files: [], jobs: t.jobs ?? [] },
    turns: t.turns,
    end_state: of("end_state"),
    required_facts: of("required_fact"),
    minefields: of("minefield"),
    collateral: {},
    graders: t.graders,
    reference: t.reference,
  });
}
