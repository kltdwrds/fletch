// The sub-agent depth cap (authority-model.md "Within one person's agent", AD-10), decided in code:
// a main agent, coordinators under it, and workers that cannot spawn. The main agent is the chat's
// own turn at depth 0; a coordinator sits at depth 1 and may start workers at depth 2; a worker
// starts nothing. Every spawn is decided here from the parent's stored record, never from what a
// model or a facet says about itself, and every refusal carries a stable code.

export type SubAgentRole = "coordinator" | "worker";
export type ParentRole = "main" | SubAgentRole;

/** The deepest a sub-agent may sit: main (0) -> coordinator (1) -> worker (2). */
export const MAX_DEPTH = 2;
/** Sub-agents one spawn may start. */
export const MAX_FANOUT = 4;
/** Sub-agents one chat may hold that have not finished, across every parent. */
export const MAX_OPEN = 12;

export type SpawnRefusal = "SUBAGENT_WORKER_CANNOT_SPAWN" | "SUBAGENT_DEPTH_CAP" | "SUBAGENT_FANOUT_CAP" | "SUBAGENT_OPEN_CAP" | "SUBAGENT_EMPTY" | "SUBAGENT_ROUNDS_CAP" | "SUBAGENT_UNKNOWN";

export interface SpawnRequest {
  role: SubAgentRole;
  brief: string;
}

export type SpawnDecision = { ok: true; depth: number } | { ok: false; code: SpawnRefusal; reason: string };

/** Whether `parent` may start `requests` now, with `open` sub-agents of the chat still unfinished. */
export function spawnDecision(parent: { role: ParentRole; depth: number }, requests: SpawnRequest[], open: number): SpawnDecision {
  if (parent.role === "worker") return { ok: false, code: "SUBAGENT_WORKER_CANNOT_SPAWN", reason: "a worker returns its result to its parent and starts no sub-agent" };
  if (!requests.length || requests.some((r) => !r.brief.trim())) return { ok: false, code: "SUBAGENT_EMPTY", reason: "every sub-agent needs a brief" };
  if (requests.length > MAX_FANOUT) return { ok: false, code: "SUBAGENT_FANOUT_CAP", reason: `one request starts at most ${MAX_FANOUT} sub-agents` };
  if (open + requests.length > MAX_OPEN) return { ok: false, code: "SUBAGENT_OPEN_CAP", reason: `a chat runs at most ${MAX_OPEN} unfinished sub-agents` };
  const depth = parent.depth + 1;
  // A coordinator exists to start workers, so it can only sit where a worker still fits below it.
  const deepest = Math.max(...requests.map((r) => (r.role === "coordinator" ? depth + 1 : depth)));
  if (deepest > MAX_DEPTH) return { ok: false, code: "SUBAGENT_DEPTH_CAP", reason: `sub-agents go at most ${MAX_DEPTH} levels below the main agent` };
  return { ok: true, depth };
}
