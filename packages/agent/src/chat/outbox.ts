// Releases a turn's committed effects after its barrier (M3.1): the outbox rows the engine queued in the
// same transaction as the step that proposed them.
import type { Approvals } from "./approvals.ts";
import type { ChatFrame } from "./frames.ts";
import type { EngineHooks } from "./hooks.ts";
import type { LinkShelf } from "./links.ts";
import type { ChatStore } from "./store.ts";
import type { ToolSession } from "../tools/registry.ts";
import type { Effect } from "./tools.ts";

export type OutboxDeps = {
  store: ChatStore;
  links: LinkShelf;
  approvals: () => Approvals;
  broadcast: (frame: ChatFrame) => void;
  subagents: EngineHooks["subagents"];
  owner: () => string | null;
  /** Sets the agent's committed reaction (F10), or skips it when its message no longer takes one. */
  react: (mid: string, emoji: string) => void;
  now: () => number;
};

/**
 * Releases committed effects: deliveries go to the sockets; gated effects go through the approval
 * flow, where an action runs only if the commit cites a grant. A crash before `markDelivered`
 * releases again with the same id: journal rows, cards and grant uses are each once per id.
 */
export async function flushOutbox(deps: OutboxDeps, _session: ToolSession): Promise<void> {
  for (const row of deps.store.undelivered()) {
    const effect = JSON.parse(row.payload) as Effect;
    if (effect.kind === "deliver") deps.broadcast({ type: "message", turn: row.turn_id, id: effect.id, text: effect.text });
    else if (effect.kind === "link") deps.links.show(row.turn_id, effect.card);
    else if (effect.kind === "react") deps.react(effect.mid, effect.emoji);
    else if (effect.kind === "delegate") await startSubagents(deps, row.turn_id, effect);
    else await deps.approvals().release(row.turn_id, effect);
    deps.store.markDelivered(row.id, deps.now());
  }
}

/** Hands a committed delegation to the host; a refusal there (the caps, decided again) joins the transcript. */
async function startSubagents(deps: OutboxDeps, turnId: string, effect: Extract<Effect, { kind: "delegate" }>): Promise<void> {
  const owner = deps.owner();
  if (!deps.subagents || !owner) return;
  const r = await deps.subagents.delegate({ grp: `${turnId.slice(0, 8)}-${effect.id.slice(0, 40)}`, turnId, person: owner, requests: effect.requests });
  if (!r.ok) deps.store.transaction(() => deps.store.appendMessage(`subagents:${effect.id}`, { role: "user", content: `The delegation ${effect.id} did not start: ${r.code}: ${r.reason ?? ""}`, timestamp: deps.now() }));
}
