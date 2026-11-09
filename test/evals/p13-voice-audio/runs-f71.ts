// The scripted model's answers for the P13 tier-1 tasks F71 runs (T-P13-02, 03, 05, 06, 07's record half, 09, 12 and 15),
// one script per task in the order the chat calls the model, the seed's steps (a render the task starts after) first.
// What a reply says is the script's, read from what the tool returned where the reply depends on it, as a model reads
// a tool's answer; what a tool returns is code's, and the graders read both.
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import type { Turn } from "../../support/task.ts";
import capsTask from "./audio-caps-refused-by-name.task.ts";
import findable from "./audio-is-a-findable-record.task.ts";
import type { P13HarnessOptions } from "./harness.ts";
import partial from "./partial-render-never-delivered.task.ts";
import readAloud from "./read-aloud-verbatim-in-chosen-voice.task.ts";
import removal from "./removal-is-recoverable-and-complete.task.ts";
import spend from "./speech-spend-capped-by-month.task.ts";
import voice from "./voice-changed-only-by-the-person.task.ts";
import note from "./voice-note-transcript-on-row.task.ts";

/** The earlier reply the read-aloud asks speak, verbatim (56 characters: 1,680 micros at aura-2-en's price). */
export const REPLY = "Sam Solo and Pat Solo are planning a picnic on Saturday.";

const load: FakeStep = { toolCall: { name: "tool_search", arguments: { load: ["speech"] } } };
const speak = (text = REPLY): FakeStep => ({ toolCall: { name: "speak", arguments: { text, topics: ["picnic"] } } });
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("") : "");
/** What the last tool returned in the request, as the model reads it. */
const lastTool = (r: FakeRequest): string => textOf([...r.inputs.messages].reverse().find((x) => x.role === "tool" || x.role === "toolResult")?.content);
/** The first audio id any tool named in the chat so far. */
const audioId = (r: FakeRequest): string => /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/.exec(r.inputs.messages.map((m) => textOf(m.content)).join("\n"))?.[1] ?? "none";
/** The reply to a read-aloud: the refusal by its code when speak refused, else that it is ready. */
const spokenReply: FakeStep = {
  fromRequest: (r) => {
    const code = /\b(SPEECH_[A-Z_]+|MODEL_[A-Z_]+|BUDGET_[A-Z_]+)\b/.exec(lastTool(r))?.[1];
    return code ? { text: `I could not read it aloud (${code}), so no audio was saved; the text is above.` } : { text: "Here is your audio: your last reply, read aloud in your voice, is in your files." };
  },
};

/** The seed of T-P13-07 and T-P13-12: one render through the production `speak`, before the task's turns. */
export const SEED: Turn[] = [{ kind: "prompt", by: "sam@solo-sam.example", text: "p13 probe: read this aloud" }];
const seedSteps = (): FakeStep[] => [load, speak(), spokenReply];

export const runsF71: Record<string, () => FakeStep[]> = {
  "T-P13-02": () => [{ text: "Your voice note's transcript says Sam Solo and Pat Solo are planning a picnic on Saturday; I read its transcript, not its sound." }],
  "T-P13-03": () => [],
  "T-P13-05": () => [{ text: REPLY }, load, speak(), spokenReply],
  "T-P13-06": () => [load, speak(), spokenReply, speak(), spokenReply],
  "T-P13-07": () => [
    ...seedSteps(),
    { toolCall: { name: "audio_list", arguments: {} } },
    { fromRequest: (r) => ({ toolCall: { name: "audio_read", arguments: { id: audioId(r) } } }) },
    { fromRequest: (r) => ({ text: `From its record: ${lastTool(r).split("\n")[0]}` }) },
  ],
  "T-P13-09": () => [load, { toolCall: { name: "voice_set", arguments: { speaker: "orion" } } }, { fromRequest: (r) => ({ text: /VOICE SET/.test(lastTool(r)) ? "Done: read-alouds now use the voice orion." : "I did not change the voice; which one do you want?" }) }],
  "T-P13-12": () => [
    ...seedSteps(),
    { toolCall: { name: "audio_list", arguments: {} } },
    { fromRequest: (r) => ({ toolCall: { name: "audio_remove", arguments: { id: audioId(r) } } }) },
    { text: "Removed: it is in your trash, and I can restore it." },
    { fromRequest: (r) => ({ toolCall: { name: "audio_restore", arguments: { id: audioId(r) } } }) },
    { text: "Restored: it is back in your files." },
  ],
  "T-P13-15": () => [load, speak(), spokenReply, speak(), spokenReply, speak(), spokenReply],
};

/** The F72 grader T-P13-07 carries, which this part does not run. */
export const F72_GRADERS = ["the Library's Audio section lists it with a player (F72)"];

export const F71_TASKS = [
  { task: note, speech: {} },
  { task: capsTask, speech: {} },
  { task: readAloud, speech: {} },
  { task: partial, speech: { cues: ["fail", "short"] } },
  { task: findable, speech: { seed: SEED } },
  { task: voice, speech: {} },
  { task: removal, speech: { seed: SEED } },
  { task: spend, speech: { monthlyMicros: 2_000 } },
] as const satisfies ReadonlyArray<{ task: typeof note; speech: NonNullable<P13HarnessOptions["speech"]> }>;

/** The options a task's tier-1 run plays under. */
export const optionsFor = (t: (typeof F71_TASKS)[number]): P13HarnessOptions => ({ script: (runsF71[t.task.id] as () => FakeStep[])(), speech: t.speech as NonNullable<P13HarnessOptions["speech"]> });

