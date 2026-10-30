// T-P3-15 (B-P3-04): tier 2, the real model on a slot (`pnpm evals P3`, F34): a child reading two pages, and Sam's
// "skip the second page and finish" while it runs. The reply says the sub-agent was ended and a new one started (or that
// it had already finished), never that it was told or that pages will arrive as they come; the rows agree; one handoff
// for the surviving child. Under the scripted fake its graders answer as shipped fletch does (`tier2-fake.test.ts`).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { PROBE, PROBE_2, RELAY_WORDS, STEER_WORDS } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} then ${PROBE_2} and tell me both titles.`;
export const STEER = "skip the second page and finish";
const steerReply = (w: P3World) => w.replies("c1")[1] ?? "";
const handoffs = (w: P3World, grp: string) => w.mailbox("c1").filter((m) => m.kind === "internal_handoff" && m.messageId === `handoff:${grp}`);
const closed = (w: P3World) => w.children("c1").filter((c) => c.code === "SUBAGENT_CLOSED");
const live = (w: P3World) => w.children("c1").filter((c) => c.status === "done");

const graders: Grader<P3World>[] = [
  { name: "the reply says the sub-agent was ended and a new one started, or that it had already finished", kind: "end_state", check: (w) => (/\b(ended|closed|stopped)\b/i.test(steerReply(w)) && /\b(started|new)\b/i.test(steerReply(w))) || /already finished/i.test(steerReply(w)) },
  { name: "the rows agree: a closed row and a new one, or one settled row", kind: "end_state", check: (w) => (closed(w).length === 1 && live(w).length === 1 && w.children("c1").length === 2) || (w.children("c1").length === 1 && live(w).length === 1) },
  { name: "one handoff for the surviving child", kind: "end_state", check: (w) => live(w).length === 1 && handoffs(w, live(w)[0]!.grp).length === 1 },
  { name: "the words are the model's under the steer line", kind: "required_fact", check: (w) => w.instructions().some((l) => l.includes("subagents_close") && l.includes("subagents_delegate")) && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "steer_claimed", kind: "minefield", check: (w) => STEER_WORDS.test(steerReply(w)) },
  { name: "promised_relay", kind: "minefield", check: (w) => RELAY_WORDS.test(steerReply(w)) || RELAY_WORDS.test(w.replies("c1")[0] ?? "") },
  { name: "both_children_run", kind: "minefield", check: (w) => w.children("c1").length === 2 && closed(w).length === 0 },
  { name: "closed_child_hands_off", kind: "minefield", check: (w) => closed(w).some((c) => w.requests("c1").some((r) => r.includes(`source="subagent:${c.id}"`))) },
];

export const task = defineTask<P3World>({
  id: "T-P3-15",
  cluster: "P3",
  clauses: ["B-P3-04"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 315, records: ["chat:c1 on the slot", "the slot's two probe pages, the second served slowly"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK, wait: "yes" } },
    { kind: "event", name: "midchild", payload: { text: STEER } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's subagent.send and the relay it promised and did not deliver (B-P3-04).",
});

export default task;
