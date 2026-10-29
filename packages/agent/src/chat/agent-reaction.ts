// The agent's own reaction (F10): one emoji on one of the person's messages, the way a friend taps a reaction. The
// `react` tool queues it as an effect like `send_to_user`'s delivery; the outbox sets it after the barrier under the
// agent reactor, so a replay lands on the same state. Any one emoji is the agent's to pick; the person's picker keeps
// the six. The agent reacts to the person's messages only, never to its own.
import { Type } from "@earendil-works/pi-ai";
import type { ToolSpec } from "../tools/registry.ts";
import type { HistoryEntry } from "./history.ts";
import type { EffectBuffer } from "./tools.ts";

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTOGRAPH = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;

/** Exactly one grapheme that starts as a pictograph or a flag letter: a skin tone, a ZWJ sequence or a flag is one. */
export function singleEmoji(s: string): boolean {
  const parts = [...GRAPHEMES.segment(s)];
  return parts.length === 1 && PICTOGRAPH.test(s);
}

export type AgentReactionRefusal = { code: "REACTION_UNKNOWN" | "MESSAGE_NOT_FOUND" | "REACTION_TARGET_NOT_PERSON"; reason: string };

/** The message the agent's reaction lands on (`mid`, or the person's latest), or why it may not. */
export function agentReactionRefusal(entries: HistoryEntry[], mid: string | undefined, emoji: string): AgentReactionRefusal | { mid: string } {
  if (!singleEmoji(emoji)) return { code: "REACTION_UNKNOWN", reason: "react with exactly one emoji" };
  const target = mid === undefined ? entries.findLast((e) => e.kind === "you") : entries.find((e) => (e.kind === "you" || e.kind === "agent") && e.mid === mid);
  if (!target || !("mid" in target)) return { code: "MESSAGE_NOT_FOUND", reason: mid === undefined ? "the person has no message in this chat" : `no message ${mid} in this chat` };
  if (target.kind !== "you") return { code: "REACTION_TARGET_NOT_PERSON", reason: `${target.mid} is your own message; react to the person's` };
  return { mid: target.mid };
}

const Params = Type.Object({
  emoji: Type.String({ minLength: 1, maxLength: 16, description: "One emoji." }),
  message: Type.Optional(Type.String({ pattern: "^[maq][0-9.]{1,40}$", description: "The id of the person's message to react to; their latest when left out." })),
});

/** The `react` tool of the core namespace; `entries` is read at call time, so the target is the history as it stands. */
export function reactTool(effects: EffectBuffer, entries: () => HistoryEntry[]): ToolSpec {
  const spec: ToolSpec<typeof Params> = {
    name: "react",
    kind: "action",
    queues: "self",
    label: "React",
    description:
      "Put one emoji on the person's message, the way a friend taps a reaction: a 👍 when you start on something they asked for or when they share a win of their own, 🫶 or nothing for a hard moment, and nothing on a plain request or question. Not a reply: anything that needs words still needs send_to_user or your answer.",
    parameters: Params,
    execute: async (toolCallId, p) => {
      const r = agentReactionRefusal(entries(), p.message, p.emoji);
      if ("code" in r) throw new Error(`${r.code}: ${r.reason}`);
      effects.push({ kind: "react", id: toolCallId, mid: r.mid, emoji: p.emoji });
      return { content: [{ type: "text", text: `reacted ${p.emoji} to ${r.mid}; it shows once this step is committed` }], details: { queued: toolCallId } };
    },
  };
  return spec as unknown as ToolSpec;
}
