// The scripted model's answers for T-P13-08 (F74), in the order the chat calls the model: the seed's two renders through
// the production `speak` (the setup's "two rendered audio files"), then the task's turns. Which file to share or revoke
// is read from what the model was shown (`speak`'s `saved at files/audio/<id>.mp3`, `share_document`'s
// `SHARED: <path> at /hooks/share/<id>.<sig>`), as a model reads a tool's answer; what each tool returns is code's.
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import type { Turn } from "../../support/task.ts";
import type { P13HarnessOptions } from "./harness.ts";

export const FIRST = "Sam Solo and Pat Solo are planning a picnic on Saturday.";
export const SECOND = "Pat Solo brings the bread; Sam Solo brings the fruit.";

/** The seed: one prompt that renders two audio files, each its own `audio_items` row under `audio/`. */
export const SEED_TWO: Turn[] = [{ kind: "prompt", by: "sam@solo-sam.example", text: "p13 probe: read these two lines aloud, one file each" }];

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("") : "");
const shown = (r: FakeRequest): string => r.inputs.messages.map((m) => textOf(m.content)).join("\n");
/** The audio files the chat has shown the model, in the order they were made. */
export const audioPaths = (r: FakeRequest): string[] => [...new Set([...shown(r).matchAll(/saved at files\/(audio\/[0-9a-f-]{36}\.mp3)/g)].map((m) => m[1] as string))];
const shareOf = (n: number, id: string): FakeStep => ({ fromRequest: (r) => ({ toolCall: { id, name: "share_document", arguments: { path: audioPaths(r)[n] ?? "audio/none.mp3" } } }) });
/** `share_revoke` of the first audio's share, its id read from `share_document`'s answer. */
const revokeFirst: FakeStep = {
  fromRequest: (r) => {
    const first = (audioPaths(r)[0] ?? "audio/none.mp3").replace(/[.]/g, "\\.");
    const id = new RegExp(`SHARED: ${first} at /hooks/share/([0-9a-f]{32})`).exec(shown(r))?.[1] ?? "none";
    return { toolCall: { id: "sr1", name: "share_revoke", arguments: { id } } };
  },
};
const said = (r: FakeRequest) => [...r.inputs.messages].reverse().find((m) => m.role === "tool" || m.role === "toolResult");

export const scriptF74 = (): FakeStep[] => [
  // The seed: two renders, then the reply.
  { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["speech"] } } },
  { toolCall: { id: "a1", name: "speak", arguments: { text: FIRST, topics: ["picnic"] } } },
  { toolCall: { id: "a2", name: "speak", arguments: { text: SECOND, topics: ["picnic"] } } },
  { text: "Both are in your files as audio: the first line, then the second." },
  // Turn 1: the first share, which waits on its card.
  { toolCall: { id: "l2", name: "tool_search", arguments: { load: ["documents"] } } },
  shareOf(0, "s1"),
  // The press: the share ran; the reply reads what it returned.
  { fromRequest: (r) => ({ text: /^SHARED:/m.test(textOf(said(r)?.content)) ? "The link to the first audio is on its share card with the time it stops working. I sent it to no one: give it to Pat Solo yourself." : "Nothing was shared." }) },
  // Turn 3: the second share raises its own card.
  shareOf(1, "s2"),
  // Turn 4: the revoke of the first, said only from the tool's answer.
  revokeFirst,
  { fromRequest: (r) => ({ text: /^REVOKED:/m.test(textOf(said(r)?.content)) ? "Revoked: the first audio's link now opens nothing. The second share still waits on its card." : "I could not revoke it; the link still works." }) },
];

export const optionsF74 = (): P13HarnessOptions => ({ script: scriptF74(), documents: true, speech: { seed: SEED_TWO } });
