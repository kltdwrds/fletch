// The scripted model's answers for the P13 tier-1 tasks F72 runs (T-P13-07 whole, T-P13-10 and T-P13-16), one script
// per task in the order the chat calls the model; what a reply says is the script's, read from what the tool returned
// where it depends on it, and what a tool returns is code's. The graders read both, and the Library as the page draws it.
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import findable from "./audio-is-a-findable-record.task.ts";
import type { P13HarnessOptions } from "./harness.ts";
import episodeTask from "./podcast-episode-record-and-feed-refused.task.ts";
import { REPLY, runsF71, SEED } from "./runs-f71.ts";
import settingsTask from "./voice-set-in-settings.task.ts";

const load: FakeStep = { toolCall: { name: "tool_search", arguments: { load: ["speech"] } } };
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("") : "");
const lastTool = (r: FakeRequest): string => textOf([...r.inputs.messages].reverse().find((x) => x.role === "tool" || x.role === "toolResult")?.content);
const audioId = (r: FakeRequest): string => /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/.exec(r.inputs.messages.map((m) => textOf(m.content)).join("\n"))?.[1] ?? "none";
const codeOf = (r: FakeRequest) => /\b([A-Z]+_[A-Z_]+)\b/.exec(lastTool(r))?.[1];

/** The episode's script: two voices, three turns, naming the two fixture people. */
export const SCRIPT = [
  { speaker: "luna", text: "Welcome. Today, Sam Solo and Pat Solo are planning a picnic." },
  { speaker: "orion", text: "They meet on Saturday by the lake." },
  { speaker: "luna", text: "Pat Solo brings the bread." },
];
export const episodeCall = (script = SCRIPT): FakeStep => ({ toolCall: { name: "speak", arguments: { as: "episode", text: "Sam Solo and Pat Solo's picnic", topics: ["picnic", "Sam Solo", "Pat Solo"], script } } });
/** The reply after a speak or a publish: the refusal by its code, else that it is ready. */
export const said: FakeStep = { fromRequest: (r) => ({ text: codeOf(r) ? `That did not happen (${codeOf(r)}): ${lastTool(r).split("\n")[0]}` : "Your episode is ready: it is in your files and your Library's Audio section." }) };

export const runsF72: Record<string, () => FakeStep[]> = {
  "T-P13-07": runsF71["T-P13-07"] as () => FakeStep[],
  "T-P13-10": () => [load, episodeCall(), said, { fromRequest: (r) => ({ toolCall: { name: "episode_publish", arguments: { id: audioId(r) } } }) }, said],
  "T-P13-16": () => [load, { toolCall: { name: "speak", arguments: { text: REPLY } } }, said],
};

export const F72_TASKS = [
  { task: findable, speech: { seed: SEED } },
  { task: episodeTask, speech: {} },
  { task: settingsTask, speech: { voice: "asteria" } },
] as const satisfies ReadonlyArray<{ task: typeof findable; speech: NonNullable<P13HarnessOptions["speech"]> }>;

export const optionsF72 = (t: (typeof F72_TASKS)[number], script?: FakeStep[]): P13HarnessOptions => ({ script: script ?? (runsF72[t.task.id] as () => FakeStep[])(), speech: t.speech as NonNullable<P13HarnessOptions["speech"]> });
