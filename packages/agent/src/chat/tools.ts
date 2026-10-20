// The effect buffer every action writes to, and the two built-in effects. A tool never acts on the
// world while it runs: an action queues an effect, and the turn loop commits the step and its
// effects together at the persistence barrier before anything leaves the object. `send_to_user`
// queues a delivery; any other action tool queues its call, performed from the outbox afterwards.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Decision, Descriptor } from "../grants/types.ts";
import type { LinkCard } from "../workspace/surfaces.ts";
import { MALFORMED_ARGS_KEY } from "../model/adapter.ts";

export interface DeliverEffect {
  kind: "deliver";
  /** The tool call id, so a redelivery after a crash carries the same id. */
  id: string;
  text: string;
}

/**
 * A queued action the gate found automatic at call time: performed once after the barrier, and only
 * if the gate's commit then still answers automatic with a grant id (M7.1).
 */
export interface ActionEffect {
  kind: "action";
  id: string;
  tool: string;
  args: Record<string, unknown>;
  descriptor: Descriptor;
  /** Words for the approval card if the commit asks the person after all (`ToolSpec.cardLines`). */
  detail?: string[];
  /** The step's tokens, for the journal row; set at the barrier. */
  tokens?: number;
}

/** A proposal waiting for its approver: an approval card, rendered by the harness after the barrier. */
export interface CardEffect {
  kind: "card";
  id: string;
  tool: string;
  args: Record<string, unknown>;
  descriptor: Descriptor;
  decision: Decision;
  /** The connector projected the call, so the model read it as applied. */
  simulated: boolean;
  /** Why the card is flagged for the person, if it is. */
  flag: string | null;
  fingerprint: string;
  /** What the person decides on beyond the descriptor's identifiers: the card's own lines (`ToolSpec.cardLines`). */
  detail?: string[];
  tokens?: number;
}

/** A call the grants refused or that was otherwise not run: journaled, never performed. */
export interface RefusalEffect {
  kind: "refusal";
  id: string;
  tool: string;
  descriptor: Descriptor;
  decision: Decision;
  outcome: string;
  /** The code the chat's action frame carries; `ACTION_DENIED` when unset. */
  code?: string;
  tokens?: number;
}

/** A gated observation that ran under a grant: journaled after the barrier. */
export interface JournalEffect {
  kind: "journal";
  id: string;
  tool: string;
  descriptor: Descriptor;
  decision: Decision;
  outcome: string;
  tokens?: number;
}
/** The main agent's delegation (M7.2): the sub-agents start after the barrier, once per id. */
export interface DelegateEffect {
  kind: "delegate";
  id: string;
  requests: Array<{ role: "worker" | "coordinator"; brief: string }>;
  tokens?: number;
}
/**
 * A link card for the person (M16.2): a decision that is theirs, in the workshop, shown with a deep link
 * and no decide button. Shown once per card id in this chat; never journaled, since nothing ran.
 */
export interface LinkEffect {
  kind: "link";
  /** The tool call id and the card id, so a redelivery after a crash carries the same id. */
  id: string;
  card: LinkCard;
}
export type Effect = DeliverEffect | ActionEffect | CardEffect | RefusalEffect | JournalEffect | DelegateEffect | LinkEffect;

/** Effects queued by the current step's tool calls, drained at the barrier. */
export class EffectBuffer {
  private pending: Effect[] = [];
  push(effect: Effect): void {
    this.pending.push(effect);
  }
  drain(): Effect[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
  get size(): number {
    return this.pending.length;
  }
}

export const SendToUserParams = Type.Object({ text: Type.String({ minLength: 1, description: "The message, in plain words." }) });

export function sendToUserTool(effects: EffectBuffer): AgentTool<typeof SendToUserParams> {
  return {
    name: "send_to_user",
    label: "Send to user",
    description: "Send a message to the person you work for, in this chat. Use it for anything they should see before the turn ends.",
    parameters: SendToUserParams,
    execute: async (toolCallId, params) => {
      effects.push({ kind: "deliver", id: toolCallId, text: params.text });
      return { content: [{ type: "text", text: "queued for delivery" }], details: { queued: toolCallId } };
    },
  };
}

/** The reply an action tool gives when called: the action is queued, not done. */
export const queuedText = (id: string, grantId: string) => `queued as ${id} under grant ${grantId}; it is performed after this step is committed`;

/**
 * Refuses a call whose arguments the adapter could not parse, before schema validation, with the
 * stable code and the parse reason; every tool the loop runs goes through this.
 */
export function refuseMalformed<T extends AgentTool<never>>(tool: T): T {
  const prepare = tool.prepareArguments;
  return {
    ...tool,
    prepareArguments: (args: unknown) => {
      if (args && typeof args === "object" && MALFORMED_ARGS_KEY in args) {
        throw new Error(`TOOL_ARGS_MALFORMED: ${String((args as Record<string, unknown>)[MALFORMED_ARGS_KEY])}`);
      }
      return prepare ? prepare(args) : args;
    },
  };
}
