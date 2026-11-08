// The scripted model's answers for the P13 tier-1 tasks F70 runs (T-P13-01, 04, 11 and 13), one script per task in the
// order the chat calls the model. What a reply says is the script's; what a tool returns is code's, and the graders
// read both.
import type { FakeStep } from "../../support/fake-model.ts";

const load: FakeStep = { toolCall: { name: "tool_search", arguments: { load: ["speech"] } } };
const status: FakeStep = { toolCall: { name: "speech_status", arguments: {} } };

export const runs: Record<string, () => FakeStep[]> = {
  "T-P13-01": () => [{ text: "I can read a text aloud or make a spoken episode when this deploy has speech, and I can tell you what it does with calls. I never start listening: the mic and dictation are your browser's." }],
  "T-P13-04": () => [{ text: "Sam Solo and Pat Solo are planning a picnic on Saturday; I have it here in our chat." }],
  "T-P13-11": () => [
    load,
    status,
    { text: "This deploy has no voice calls (VOICE_CALL_UNAVAILABLE), so nothing from a call is kept, because none happens." },
    status,
    { text: "This deploy has no voice calls (VOICE_CALL_UNAVAILABLE), so I cannot call you; we can keep talking here." },
  ],
  "T-P13-13": () => [
    load,
    { toolCall: { name: "speak", arguments: { text: "p13 probe: the last reply." } } },
    { text: "I could not read it aloud (SPEECH_UNAVAILABLE): this deploy cannot speak yet. 2 + 2 is 4." },
    { toolCall: { name: "speak", arguments: { text: "Sam Solo and Pat Solo are planning a picnic on Saturday.", as: "episode" } } },
    { text: "I could not make the episode (SPEECH_UNAVAILABLE): this deploy cannot speak yet, so no file was made." },
  ],
};
