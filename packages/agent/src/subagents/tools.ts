// The main agent's `subagents` namespace (M7.2): delegate parts of the person's own task, and read
// their status. Delegating queues its own effect, so the sub-agents start only after the step's
// barrier; its answer says the handoff will arrive, and nothing about what it will say (B19). Only
// the person's own task delegates: a colleague's request, a latched task or a chat over its caps is
// refused with a code. The status tool reads the stored rows, so a status answer is observed state.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { TurnContext } from "../chat/gate.ts";
import type { EffectBuffer } from "../chat/tools.ts";
import type { Namespace } from "../tools/registry.ts";
import { MAX_FANOUT, spawnDecision } from "./depth.ts";
import type { CloseResult, SubAgentHost } from "./host.ts";

const text = (t: string, details: Record<string, unknown> = {}): AgentToolResult<unknown> => ({ content: [{ type: "text", text: t }], details });

export interface SubAgentsView {
  open(): number;
  status(): ReturnType<SubAgentHost["status"]>;
  /** Ends the named sub-agents (and any below them) that have not settled; the person's own, decided from the stored rows. */
  close(person: string, ids: string[]): Promise<CloseResult>;
}

export const DelegateParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal("worker"), Type.Literal("coordinator")], { description: "worker: does one part and reports; coordinator: may split its part among workers" }),
      brief: Type.String({ minLength: 1, description: "Everything the sub-agent needs: the part of the task, what to report, and what not to do." }),
    }),
    { minItems: 1, maxItems: MAX_FANOUT },
  ),
});

export function subagentsNamespace(view: SubAgentsView, o: { effects: EffectBuffer; context: TurnContext; latched: () => boolean; person: string }): Namespace {
  return {
    name: "subagents",
    description: "sub-agents for parts of the person's own task, in parallel; their handoffs return to this chat",
    deferral: "names",
    tools: [
      {
        name: "subagents_delegate",
        kind: "action",
        queues: "self",
        label: "delegate to sub-agents",
        description: `Start up to ${MAX_FANOUT} sub-agents on parts of the person's own task. They run after this step, and their handoff arrives in this chat when all have returned; do not predict what they will find.`,
        parameters: DelegateParams,
        execute: async (id, params) => {
          if (o.context.counterpart.kind !== "own-agent") return text("SUBAGENT_OWN_TASK_ONLY: only the person's own task is delegated, never a colleague's request", { code: "SUBAGENT_OWN_TASK_ONLY" });
          if (o.latched()) return text("LATCH_NO_FORWARDING: this task read restricted data, so nothing is handed to another agent", { code: "LATCH_NO_FORWARDING" });
          const requests = (params as { tasks: Array<{ role: "worker" | "coordinator"; brief: string }> }).tasks;
          const d = spawnDecision({ role: "main", depth: 0 }, requests, view.open());
          if (!d.ok) return text(`${d.code}: ${d.reason}`, { code: d.code });
          o.effects.push({ kind: "delegate", id, requests });
          return text(`delegated ${requests.length} sub-agent${requests.length > 1 ? "s" : ""} as ${id}; they start after this step, and their handoff arrives in this chat when all have returned`, { delegated: id });
        },
      },
      {
        name: "subagents_close",
        kind: "action",
        queues: "self",
        label: "close sub-agents",
        description: "End sub-agents this chat started that have not finished, and any they started. A sub-agent that already finished is left as it is; a closed one returns no handoff.",
        parameters: Type.Object({ ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 32, description: "Sub-agent ids, as subagents_status shows them." }) }),
        execute: async (_id, params) => {
          if (o.context.counterpart.kind !== "own-agent") return text("SUBAGENT_OWN_TASK_ONLY: only the person's own task closes sub-agents", { code: "SUBAGENT_OWN_TASK_ONLY" });
          const r = await view.close(o.person, (params as { ids: string[] }).ids);
          if (!r.ok) return text(`${r.code}: ${r.reason}`, { code: r.code });
          const said = [r.closed.length ? `closed ${r.closed.join(", ")}` : "nothing was still running", r.settled.length ? `already finished: ${r.settled.join(", ")}` : ""].filter(Boolean).join("; ");
          return text(said, { closed: r.closed, settled: r.settled });
        },
      },
      {
        name: "subagents_status",
        kind: "observation",
        label: "sub-agent status",
        description: "The status of this chat's sub-agents as stored: queued, running, waiting on workers, done or failed.",
        parameters: Type.Object({}),
        execute: async () => {
          const rows = view.status();
          if (!rows.length) return text("no sub-agents in this chat");
          return text(rows.map((r) => `${r.role} ${r.id}: ${r.status}${r.code ? ` (${r.code})` : ""}${r.verdict ? `; verifier: ${r.verdict}` : ""}${r.refusals.length ? `; refused: ${r.refusals.join(", ")}` : ""}`).join("\n"));
        },
      },
    ],
  };
}
