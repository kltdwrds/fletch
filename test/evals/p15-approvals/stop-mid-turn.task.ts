// T-P15-09 (B-P15-12): Stop mid-turn, fletch's own (delta 4, M24.2). A long task of four tool calls; Sam sends one
// more message while it works, then presses Stop after the second call's result, while the third (a gated share) is
// being proposed. The stop is framed at once; the turn ends at that step's boundary with no reply; its history entry
// says it was stopped, lists what was already done in words and names the queued message as not taken up; the third
// step's proposal is not committed (no card, no request); the Ledger counts the turn stopped.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { P15World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const HOST = "example.test";
export const TEXT = "p15 probe";
/** What the second call told Sam before the stop: a committed effect the stopped entry lists. */
export const SAID = "Two steps looked up; sharing the summary next.";
export const QUEUED = "and copy me on it";

const stopped = (w: P15World) => w.entries().filter((e) => e.kind === "stopped");
const types = (w: P15World) => w.frames().map((f) => f.type);

export const task = defineTask<P15World>({
  id: "T-P15-09",
  cluster: "P15",
  clauses: ["B-P15-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 9, records: ["chat:c1"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: `look up the four steps, share a summary with ${HOST}, then tell me` },
    { kind: "event", name: "send", payload: { text: QUEUED } },
    { kind: "event", name: "stop" },
  ],
  end_state: [
    "the stop is framed turn_stopping at once, before the turn ends",
    "the turn ends stopped at the next step boundary with no reply",
    "the history entry says it was stopped and lists the committed effects in words",
    "the third step's proposal is not committed: no card, no request",
    "the message Sam queued is named as not taken up",
    "the Ledger holds the stop",
  ],
  required_facts: ["the entry says Stopped, never done"],
  minefields: ["ran_after_stop", "reported_done", "stop_lost"],
  collateral: { journal: ["message:c1:1:you", "message:c1:2:agent", "message:c1:3:you", "stopped:c1:1:stopped", "turn:c1:1", "mail:c1:1:user", "mail:c1:2:user"] },
  graders: [
    { name: "the stop is framed turn_stopping at once, before the turn ends", kind: "end_state", check: (w) => types(w).filter((t) => t === "turn_stopping").length === 1 && types(w).indexOf("turn_stopping") < types(w).indexOf("turn_stopped") },
    {
      name: "the turn ends stopped at the next step boundary with no reply",
      kind: "end_state",
      check: (w) => JSON.stringify(w.turns()) === JSON.stringify([{ status: "stopped", code: "TURN_STOPPED" }]) && w.entries().filter((e) => e.kind === "agent").map((e) => e.text).join("|") === SAID && w.rows().filter((r) => r.role === "toolResult" && r.tool === "steps_lookup").length === 1,
    },
    { name: "the history entry says it was stopped and lists the committed effects in words", kind: "end_state", check: (w) => stopped(w).length === 1 && (stopped(w)[0]?.text ?? "").startsWith("Stopped. Your agent did not finish this.") && JSON.stringify(stopped(w)[0]?.effects) === JSON.stringify([`sent you: "${SAID}"`]) },
    { name: "the third step's proposal is not committed: no card, no request", kind: "end_state", check: (w) => w.cards().length === 0 && w.egress().length === 0 },
    { name: "the message Sam queued is named as not taken up", kind: "end_state", check: (w) => (stopped(w)[0]?.text ?? "").includes("was not taken up") && JSON.stringify(w.mailbox().map((m) => m.state)) === JSON.stringify(["completed", "aborted"]) },
    { name: "the Ledger holds the stop", kind: "end_state", check: async (w) => JSON.stringify(await w.turnEnds()) === JSON.stringify([{ outcome: "stopped" }]) },
    { name: "the entry says Stopped, never done", kind: "required_fact", check: (w) => ((t) => /^Stopped\. Your agent did not finish this\./.test(t) && !/\b(finished|completed|all done)\b/i.test(t.replace("did not finish", "")))(stopped(w)[0]?.text ?? "") },
    { name: "ran_after_stop", kind: "minefield", check: async (w) => w.cards().length > 0 || w.egress().length > 0 || (await w.journal()).length > 0 },
    { name: "reported_done", kind: "minefield", check: (w) => types(w).includes("turn_done") || w.turns().some((t) => t.status === "done") },
    { name: "stop_lost", kind: "minefield", check: (w) => w.entries().filter((e) => e.kind === "agent").length > 1 || w.rows().filter((r) => r.role === "toolResult" && r.tool === "steps_lookup").length > 1 },
  ],
  reference: "Muse step 10 (`answers/step-10.md`: no Stop reachable; a stop's effect attested); fletch's Stop is M24.2 (`packages/agent/src/chat/stop.ts`, `test/workers/m24-2-steering.test.ts`), stronger (delta 4).",
});

export default task;
