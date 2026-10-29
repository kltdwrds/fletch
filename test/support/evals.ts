// What a tier-2 grader sees (parity framework design §3 "Tiers"; F19). A tier-2 task (`tier: 2` in
// `test/evals/<cluster>/<task>.task.ts`) is graded on a preview slot with the real model: its graders take a
// `SlotWorld`, one chat on the slot driven through the app's own routes as the slot's owner. The runner
// (`scripts/evals/runner.ts`) separates two failures by type: an `InfraError` is the slot's (no lease, a lapsed
// lease, a 5xx or no answer before the first model call, no session) and is never counted against the agent; a
// `TurnError` is the agent's (a refused send, a failed or stopped turn, a turn that did not end). Tier 2 has no
// collateral check: the graders are the whole grade, so `snapshot()` answers nothing.
import type { ScenarioWorld, Snapshot } from "./scenario.ts";

export const INFRA_CODES = ["SLOT_MISSING", "LEASE_LAPSED", "SLOT_5XX", "SLOT_UNREACHABLE", "SESSION_UNAVAILABLE"] as const;
export type InfraCode = (typeof INFRA_CODES)[number];

/** The slot failed before or outside a model call: the trial is `infra`, never `fail`. */
export class InfraError extends Error {
  readonly code: InfraCode;
  constructor(code: InfraCode, reason: string) {
    super(`${code}: ${reason}`);
    this.code = code;
  }
}

/** The agent's turn did not end in a reply: `REFUSED:<code>`, `TURN_FAILED:<code>`, `TURN_STOPPED`, `TURN_TIMEOUT`, `SOCKET_CLOSED`. */
export class TurnError extends Error {
  readonly code: string;
  constructor(code: string, reason = "") {
    super(reason ? `${code}: ${reason}` : code);
    this.code = code;
  }
}

export interface SlotWorld extends ScenarioWorld {
  /** The chat this trial runs in. */
  readonly chatId: string;
  /** The agent's reply to each prompt so far, in order; the last is what the last turn said. */
  readonly replies: string[];
  /** Sends one prompt as the slot's owner and resolves with the reply once the turn is done; rejects with a `TurnError`. */
  send(text: string): Promise<string>;
  /** Reads an app route with the trial's session. */
  read(path: string): Promise<{ status: number; body: unknown }>;
}

export const EMPTY_SNAPSHOT: Snapshot = { journal: [], vault: [], r2: [] };
