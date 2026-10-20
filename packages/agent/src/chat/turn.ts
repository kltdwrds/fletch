// The turn loop: PiHarness (`@earendil-works/pi-agent-core`) behind this one adapter (AD-2). The
// rest of the agent sees `runTurnLoop` only, so a harness swap changes this file and nothing else.
//
// Each model step ends at the persistence barrier: pi's `finishTurn`, called after the assistant
// message and all its tool results exist and before the next request. The barrier commits the step
// and the effects its tools queued in one transaction; only then may effects leave the object. A
// step that errors never reaches the barrier, so its effects are dropped with it.
import { type AgentEvent, type AgentTool, runAgentLoopContinue, type StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { fence } from "../context/fence.ts";
import { type Effect, type EffectBuffer, refuseMalformed } from "./tools.ts";
import { traceTool, traceTurn } from "../obs/spans.ts";

export interface Step {
  message: AssistantMessage;
  toolResults: ToolResultMessage[];
  effects: Effect[];
  /** True when the model asked for no tool, so this step ends the turn. */
  final: boolean;
  /** True when a call in this step waits for a person's decision: the turn ends here (`awaitDecision`). */
  paused: boolean;
  /** True when the person asked to stop (M24.2): the turn ends here, and this step's effects are not committed. */
  stopped: boolean;
  /** True when mailbox rows wait (M24.2): the barrier takes them in, and the turn goes on to answer them. */
  steer: boolean;
}

/** Frames streamed to the chat's sockets while a turn runs. */
export type StreamFrame = { type: "delta"; turn: string; text: string } | { type: "reasoning"; turn: string; text: string };

export interface TurnLoopOptions {
  turnId: string;
  /** The chat the turn belongs to, named on its spans (M15.3). */
  conversation?: string;
  model: Model<string>;
  streamFn: StreamFn;
  tools: AgentTool<never>[];
  effects: EffectBuffer;
  /** The assembled request messages; the last one is a user or tool result message. */
  messages: Message[];
  /** Commits a finished step; throwing aborts the turn without releasing the step's effects. */
  barrier: (step: Step) => void;
  /** Runs after a successful barrier, outside its transaction. */
  afterBarrier: (step: Step) => Promise<void>;
  onFrame: (frame: StreamFrame) => void;
  /** Steps this loop may still take; the compromised-model guard. */
  maxSteps: number;
  /** Asked after each step's tools ran, with that step's message and before its barrier: true ends the turn after this step, for a decision to arrive. */
  pauseAfter?: (message: AssistantMessage) => boolean;
  /** Asked at each step boundary: true ends the turn there, stopped (M24.2). */
  stopRequested?: () => boolean;
  /** Asked at each step boundary: true when queued mailbox rows wait for this turn (M24.2). */
  queued?: () => boolean;
  /** The block the barrier just took in, handed to the model before its next request (pi's steering). */
  steering?: () => Message[];
  signal?: AbortSignal;
}

export type TurnOutcome = { status: "done"; steps: number; paused: boolean; stopped: boolean } | { status: "failed"; code: string; detail: string; steps: number };

/** Turns end after this many model steps with `TURN_STEP_LIMIT`, whatever the model asks for. */
export const MAX_STEPS_PER_TURN = 8;

/** One turn in an `invoke_agent` span; its tool calls in `execute_tool` spans and its model requests in `chat` spans (M15.3). */
export function runTurnLoop(o: TurnLoopOptions): Promise<TurnOutcome> {
  return traceTurn({ conversation: o.conversation, turnId: o.turnId, model: o.model.id }, () => turnLoop(o), (r) => (r.status === "failed" ? r.code : null));
}

async function turnLoop(o: TurnLoopOptions): Promise<TurnOutcome> {
  let steps = 0;
  let final = false;
  let paused = false;
  let stopped = false;
  let failure: { code: string; detail: string } | undefined;
  let barrierError: unknown;

  const emit = async (event: AgentEvent) => {
    if (event.type !== "message_update") return;
    const e = event.assistantMessageEvent;
    if (e.type === "text_delta") o.onFrame({ type: "delta", turn: o.turnId, text: e.delta });
    if (e.type === "thinking_delta") o.onFrame({ type: "reasoning", turn: o.turnId, text: e.delta });
  };

  // Wrapped in place: pi reads this array before every request, so tools pushed into it by
  // `tool_search` mid-turn are declared to the model at the next step.
  o.tools.splice(0, o.tools.length, ...o.tools.map((t) => traceTool(refuseMalformed(t), o.conversation)));
  await runAgentLoopContinue(
    { messages: o.messages, tools: o.tools },
    {
      model: o.model,
      convertToLlm: (messages) => messages as Message[],
      toolExecution: "sequential",
      // Every tool result enters the context fenced with its source label (AD-6), errors included.
      afterToolCall: async ({ toolCall, result }) => ({
        content: result.content.map((c) => (c.type === "text" ? { type: "text" as const, text: fence(`tool:${toolCall.name}`, c.text) } : c)),
      }),
      finishTurn: async ({ message, toolResults }) => {
        // pi calls this for a failed response too; a failed step is never committed and its
        // effects are dropped with it. The outcome is read from the message after the loop.
        if (message.stopReason === "error" || message.stopReason === "aborted") {
          o.effects.drain();
          return { action: "end" };
        }
        steps++;
        const isFinal = !message.content.some((c) => c.type === "toolCall");
        const stop = o.stopRequested?.() ?? false;
        const pause = !stop && !isFinal && (o.pauseAfter?.(message) ?? false);
        // Input the person added meanwhile is taken at this boundary while a step remains to answer it;
        // otherwise it waits in the mailbox and starts the next turn.
        const steer = !stop && !pause && steps < o.maxSteps && (o.queued?.() ?? false);
        const step: Step = { message, toolResults, effects: o.effects.drain(), final: isFinal && !steer && !stop, paused: pause, stopped: stop, steer };
        try {
          o.barrier(step);
        } catch (err) {
          barrierError = err;
          return { action: "end" };
        }
        await o.afterBarrier(step);
        if (step.stopped) {
          stopped = true;
          return { action: "end" };
        }
        if (step.final || step.paused) {
          final = true;
          paused = step.paused;
          return { action: "end" };
        }
        if (steps >= o.maxSteps) {
          failure = { code: "TURN_STEP_LIMIT", detail: `the turn took ${steps} steps without a final answer` };
          return { action: "end" };
        }
        return undefined;
      },
      getSteeringMessages: async () => o.steering?.() ?? [],
    },
    emit,
    o.signal,
    o.streamFn,
  ).then(
    (messages) => {
      const last = [...messages].reverse().find((m): m is AssistantMessage => (m as Message).role === "assistant");
      if (!failure && last && (last.stopReason === "error" || last.stopReason === "aborted")) {
        const [code, ...rest] = (last.errorMessage ?? "MODEL_CALL_FAILED").split(": ");
        failure = { code: code ?? "MODEL_CALL_FAILED", detail: rest.join(": ") };
      }
    },
    (err: unknown) => {
      failure ??= { code: "TURN_LOOP_FAILED", detail: String(err) };
    },
  );

  if (barrierError) throw barrierError;
  if (failure) return { status: "failed", ...failure, steps };
  if (stopped) return { status: "done", steps, paused: false, stopped: true };
  if (!final) return { status: "failed", code: "TURN_INCOMPLETE", detail: "the loop ended without a final step", steps };
  return { status: "done", steps, paused, stopped: false };
}
