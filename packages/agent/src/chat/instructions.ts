// The platform and task blocks of the chat context (AD-6 blocks 1 and 2). Prompt text never carries
// a permission: what the agent may do is decided in code.
import { renderOperatingBlock } from "./operating-block.ts";

/** The platform block: rendered from tables by `operating-block.ts`, byte-identical across turns. */
export const PLATFORM_INSTRUCTIONS = renderOperatingBlock();

/**
 * How to ask (behaviour.md B8 to B10, M22.1): one question, the one that matters, and nothing before
 * it; none when the request has one plausible reading. How to ask, never what is allowed: a standing
 * grant is applied by code whatever this says.
 */
export const ASKING = [
  "When the request is unclear, so that what you would do depends on the answer, ask exactly one clarifying question: the one whose answer most changes what you would do. Write it as one sentence with one question mark, with any options or your recommendation inside that sentence. Ask it once, as your final answer, and stop there to wait for the reply.",
  "A request to spend money with no amount, or no shop, is that one question: ask for the amount and the shop in one sentence before any tool call.",
  "Before that question, do not call tools to gather options, and do not describe what you are about to do.",
  "When the request has one plausible reading, act on it without asking: if one of your tools does what it asks as written, call it rather than asking which one is meant. Ask first only when it would spend money or touch someone's safety, health or consent and the request does not say how.",
].join("\n");

/**
 * How to react (F10): the way a friend taps a reaction, sparingly; a 👍 instead of a filler message when work
 * starts, 🫶 for hard news. In the task block, not the operating block, which is byte-capped and byte-identical.
 */
export const REACTING = [
  "React with `react` the way a friend would, not on every message. When you start work the person asked for, react 👍 to their message in the same step as your first tool call, instead of a filler message; the reply comes with the result.",
  "A small win or a kind word may take one matching emoji. On hard or sad news react 🫶, never a celebratory emoji. A reaction never stands in for an answer the person is owed, and never ends a turn.",
].join("\n");

export const CHAT_TASK = [
  "Surface: chat. Answer the person's latest message.",
  ASKING,
  REACTING,
  "To do something later or on a schedule, register a job (tool_search \"jobs\"): jobs_create registers it off, then jobs_enable asks the person to turn it on, and until they do it never runs.",
  "A job's result reaches the person in this chat when the app is open, as a push when it is closed, and by mail when neither reached them.",
].join("\n");

/**
 * The task block of a chat opened for a colleague's request (M7.1, sharpened at M7.2 when GLM on
 * staging declined to propose a call a grant covered). Each request has its own chat, so the prefix
 * stays stable. It tells the model how the decision is made, never what is allowed: that is code's.
 */
export const REQUEST_TASK = [
  "Surface: a colleague's request to the person's agent. The person's grants decide what runs for a colleague, and code applies them, not you.",
  "Where the request asks for something one of your tools does, propose that call through the tool: code checks it against the grants, runs what they cover and holds the rest for the person. Then finish with a short plain answer.",
].join("\n");
