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

/** A history entry as the socket's `history` frame carries it: the fields a grader reads. */
export interface SlotEntry {
  kind: string;
  mid?: string;
  /** A stopped entry's turn (F34: its id in the thread). */
  turn?: string;
  text?: string;
  reactions?: Array<{ by: "you" | "agent"; emoji: string }>;
  /** A card entry's view (`chat/cards.ts` `CardView`): the fields a grader reads. */
  card?: { id: string; state: string; title: string; proposed: Record<string, unknown>; dest: string; status: string };
}

/** One reaction row as a grader reads it: the agent's under `"agent"`, the owner's under their email. */
export interface SlotReaction {
  mid: string;
  by: string;
  emoji: string;
}

/** The reaction rows the history carries, the agent's first on each message as the frame orders them. */
export function reactionsOf(entries: SlotEntry[], owner: string): SlotReaction[] {
  const out: SlotReaction[] = [];
  for (const e of entries) for (const r of e.reactions ?? []) if (e.mid) out.push({ mid: e.mid, by: r.by === "agent" ? "agent" : owner, emoji: r.emoji });
  return out;
}

export interface SlotWorld extends ScenarioWorld {
  /** The chat this trial runs in. */
  readonly chatId: string;
  /** The agent's reply to each prompt so far, in order; the last is what the last turn said. */
  readonly replies: string[];
  /** The history of the trial's first chat as the page draws it, read from the socket's `history` frame after its last turn ended. */
  entries(): SlotEntry[];
  /** The reaction rows of that history (`reactionsOf`). */
  reactions(): SlotReaction[];
  /**
   * Sends one prompt as the slot's owner into the chat `chat` labels (the first, `c1`, when unset; another label is a
   * new chat on its first prompt, F28) and resolves with the reply once the turn is done; rejects with a `TurnError`.
   * With `wait` (F34), the sub-agents it launched are left running when the turn ends.
   */
  send(text: string, chat?: string, wait?: boolean): Promise<string>;
  /** Reads an app route with the trial's session. */
  read(path: string): Promise<{ status: number; body: unknown }>;
  /**
   * Plays an event as the owner would (`SLOT_EVENTS` in `scripts/evals/runner.ts`): `decide` posts the decision on a
   * card of this chat (payload `card`: its id, `first` for the chat's first card, or unset for its pending card; `choice`)
   * through the page's route, then waits out the turn the decision continues. Rejects with a `TurnError` when there is
   * nothing to decide. A P7 world (F30) also plays `tick` (payload `job`: a title; the job's next alarm fired by the test
   * host, waited out to its run's end and the turn its notice wakes) and `reload` (the world read again). Any world plays
   * `prompt` (payload `text`, `chat`, `wait`) as `send` (F34); a P3 world also plays `midchild` and `children`
   * (`scripts/evals/p3-slot.ts`).
   */
  event(name: string, payload: Record<string, string>): Promise<void>;
}

/**
 * What a slot's test host lets a grader read (F26, `scripts/preview-slot/test-host.mjs`), refreshed after every turn
 * and event: the P15 world's readers over the slot. The test host's browser has no live session, so no page opens and
 * nothing is typed; every read of a fixture site is a request. The Vault's audit and Sam's grants count from the
 * trial's start. On a slot that serves no test host each reader throws `SLOT_NO_TEST_HOST`.
 */
export interface TestHostReaders {
  cards(): Array<{ id: string; state: string; host: string | null }>;
  egress(): Array<{ host: string; text: string }>;
  opened(): string[];
  typed(): Array<{ host: string; value: string }>;
  requestsTo(host: string): number;
  audit(): unknown[];
  vaultGrants(): Array<{ nonce: string; hosts: string[]; oneShot: boolean; usedAt: number | null }>;
  sinks(): Promise<Record<string, string>>;
}

export const EMPTY_SNAPSHOT: Snapshot = { journal: [], vault: [], r2: [] };
