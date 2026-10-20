// Delegation (B19): delegated results are acknowledged and awaited, never predicted or fabricated;
// a status answer comes from observed state. The delegating turn ends without the result; while the
// sub-agents wait for the chat's alarm no model call is made (no polling); a status question reads
// the stored rows; the handoff enters the chat once, fenced, after every sub-agent has returned.
import { describe, expect } from "vitest";
import { defineScenario } from "../../support/scenario.ts";
import { subagentWorld, verdict } from "../../workers/support/subagent-world.ts";

const LAUNCH = "The launch is Thursday.";
const BUDGET = "The budget is 120.";

describe("[M7.2] delegation", () => {
  defineScenario({
    id: "S-B19-awaited-not-predicted",
    clauses: ["B19"],
    seed: 19,
    setup() {
      const w = subagentWorld({
        script: [
          { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["subagents"] } } },
          { toolCall: { id: "d1", name: "subagents_delegate", arguments: { tasks: [{ role: "worker", brief: "Find the launch date in Ada's notes." }, { role: "worker", brief: "Find the budget in Ada's notes." }] } } },
          { text: "I've started two sub-agents and will report when they return." },
          // Ada asks for status before the alarm: the main agent reads the stored rows.
          { toolCall: { id: "s1", name: "subagents_status", arguments: {} } },
          { text: "Both are still queued." },
          // The alarm: each worker reads and reports; the verifier checks each handoff.
          { toolCall: { id: "n1", name: "notes_read", arguments: {} } },
          { text: LAUNCH },
          verdict("pass"),
          { toolCall: { id: "n2", name: "notes_read", arguments: {} } },
          { text: BUDGET },
          verdict("pass"),
          // The handoff turn of the main agent.
          { text: `${LAUNCH} ${BUDGET}` },
        ],
      });
      return Object.assign(w, { callsWhileWaiting: 0, snapshot: async () => ({ journal: (await w.ledger().journalRows()).map((r) => r.id), vault: [], r2: [] }) });
    },
    async turns(w) {
      await w.say("When is the launch and what's the budget? Split it up.");
      const before = w.fake.requests.length;
      await w.say("Status?");
      w.callsWhileWaiting = w.fake.requests.length - before - 2;
      await w.settle();
    },
    endState(w) {
      expect(w.callsWhileWaiting).toBe(0);
      const status = w.toolResults().find((t) => t.includes("worker ") && t.includes(": queued"));
      expect(status).toBeDefined();
      expect(w.rows().map((r) => [r.status, r.verdict, r.result])).toEqual([
        ["done", "pass", LAUNCH],
        ["done", "pass", BUDGET],
      ]);
      const handoffs = w.transcript().filter((t) => t.includes("Your sub-agents have returned"));
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]).toContain('source=\\"subagent:');
    },
    minefields: [
      {
        name: "a result in the chat before the sub-agents returned",
        happened: (w) => {
          const t = w.transcript();
          const handoffAt = t.findIndex((m) => m.includes("Your sub-agents have returned"));
          // The message text only, with 120 as a whole word: a stored message also carries a wall-clock
          // `timestamp` and sub-agent ids, whose digits contain "120" by chance in a few percent of runs.
          const textOf = (m: string): string => {
            try {
              const c = (JSON.parse(m) as { content?: unknown }).content;
              return typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => String((p as { text?: unknown }).text ?? "")).join("") : "";
            } catch {
              return m;
            }
          };
          return t.slice(0, handoffAt < 0 ? t.length : handoffAt).some((m) => /Thursday|\b120\b/.test(textOf(m)));
        },
      },
      { name: "a status answer not read from the store", happened: (w) => !w.toolResults().some((t) => /worker [^:]+: queued/.test(t)) },
      { name: "a sub-agent run twice", happened: (w) => new Set(w.runs.map((r) => r.id)).size !== w.runs.length },
    ],
    declared: () => ({}),
  });
});
