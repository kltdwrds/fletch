// One model call whose raw stream is kept, for the staging recording of a GLM 5.3 Flash stream
// (VERIFY-AT-M1, the reasoning-delta shape). It is the chat route's request shape, assembled as a
// chat turn with `send_to_user` declared, through the adapter, so it is gated, gatewayed and in the
// Ledger like any other call. The prompt is fixed here; nothing in the request reaches it.
import { normalizeContext } from "@earendil-works/pi-ai";
import { CHAT_TASK, PLATFORM_INSTRUCTIONS } from "../chat/instructions.ts";
import { EffectBuffer, sendToUserTool } from "../chat/tools.ts";
import { assemble } from "../context/assemble.ts";
import type { LedgerSink } from "../ledger/types.ts";
import { createStreamFn } from "./adapter.ts";
import { modelFor } from "./routes.ts";

export const SAMPLE_PROMPT = "Use send_to_user to tell me, in one short sentence, that the stream sample works. Think it through briefly first.";

export async function recordModelSample(deps: { ai: Ai; ledger: LedgerSink; tenant: string; person: string; now: () => number }): Promise<{ raw: string; ok: boolean; error?: string }> {
  const model = modelFor("chat");
  let raw = "";
  const tap = (text: string) => {
    raw += text;
  };
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const streamFn = createStreamFn(
    { ai: deps.ai, ledger: deps.ledger, now: deps.now, wait, tap },
    { tenant: deps.tenant, person: deps.person, runId: `sample-${crypto.randomUUID()}`, route: "chat" },
  );
  const messages = assemble({
    platform: PLATFORM_INSTRUCTIONS,
    task: CHAT_TASK,
    standingFiles: [],
    memory: [],
    skills: [],
    envelope: { now: deps.now(), timeZone: "UTC", surface: "chat", modelId: model.id, owner: deps.person },
    tools: [sendToUserTool(new EffectBuffer())] as never,
    transcript: [{ role: "user", content: SAMPLE_PROMPT, timestamp: deps.now() }],
  });
  const message = await (await streamFn(model, normalizeContext({ messages }), {})).result();
  const failed = message.stopReason === "error" || message.stopReason === "aborted";
  return failed ? { raw, ok: false, error: message.errorMessage } : { raw, ok: true };
}
