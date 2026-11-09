// Every guard F71 adds, planted on the production path (KICKOFF, "Plant the guard"): the monthly speech cap taken out
// of the Ledger's admission, a model's price taken out of `SPEECH_PRICES`, the length check taken out of the render
// (`mp3Duration`), the person's voice taken out of `speak`, the typed-words check taken out of `voice_set`, the trash
// copy left behind by restore, and the Ledger taken out of the service; each fails the grader or the check that holds it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEECH_PRICES } from "../../../packages/agent/src/ledger/budget.ts";
import { ChatStore } from "../../../packages/agent/src/chat/store.ts";
import { PersonAudio } from "../../../packages/agent/src/speech/audio.ts";
import { speechOf, speechService } from "../../../packages/agent/src/speech/speech.ts";
import { graded, played, sam } from "./harness.ts";
import partial from "./partial-render-never-delivered.task.ts";
import readAloud from "./read-aloud-verbatim-in-chosen-voice.task.ts";
import removal from "./removal-is-recoverable-and-complete.task.ts";
import { F71_TASKS, optionsFor, REPLY } from "./runs-f71.ts";
import spend from "./speech-spend-capped-by-month.task.ts";
import voice from "./voice-changed-only-by-the-person.task.ts";
import note from "./voice-note-transcript-on-row.task.ts";
import { fakeSpeechAI, SPEAK_MODEL, TRANSCRIBE_MODEL } from "./world.ts";

const plant = vi.hoisted(() => ({ cap: false, bounds: false }));
vi.mock("../../../packages/agent/src/ledger/budget.ts", async (original) => {
  const m = await original<typeof import("../../../packages/agent/src/ledger/budget.ts")>();
  return { ...m, decideSpeech: (...a: Parameters<typeof m.decideSpeech>) => (plant.cap ? { ok: true as const } : m.decideSpeech(...a)) };
});
vi.mock("../../../packages/agent/src/speech/mp3.ts", async (original) => {
  const m = await original<typeof import("../../../packages/agent/src/speech/mp3.ts")>();
  return { ...m, mp3Duration: (b: Uint8Array) => (plant.bounds ? { ms: 5_000, frames: 1 } : m.mp3Duration(b)) };
});

const options = (id: string) => optionsFor(F71_TASKS.find((t) => t.task.id === id) as (typeof F71_TASKS)[number]);
const all = (g: Record<string, boolean>) => Object.values(g).every(Boolean);

afterEach(() => {
  plant.cap = false;
  plant.bounds = false;
  vi.restoreAllMocks();
});

describe("[F71] P13 speech: each guard planted", () => {
  it("the monthly cap taken out of the Ledger's admission: the third read-aloud runs and the cap's graders fail", async () => {
    expect(all(await graded(spend, await played(spend, options("T-P13-15"))))).toBe(true);
    plant.cap = true;
    const w = await played(spend, options("T-P13-15"));
    const g = await graded(spend, w);
    expect([w.speechCalls().length, g["the call after the cap refused SPEECH_BUDGET_EXHAUSTED"], g.silent_refusal]).toEqual([4, false, false]);
  });

  it("a speech model without a price is refused MODEL_UNPRICED before any AI.run", async () => {
    const price = SPEECH_PRICES[SPEAK_MODEL];
    delete SPEECH_PRICES[SPEAK_MODEL];
    try {
      const w = await played(readAloud, options("T-P13-05"));
      expect([w.speechCalls().length, w.refusals(), w.audio().length]).toEqual([0, ["MODEL_UNPRICED"], 0]);
    } finally {
      SPEECH_PRICES[SPEAK_MODEL] = price as (typeof SPEECH_PRICES)[string];
    }
  });

  it("the length check taken out: the cut-short render is delivered and partial_delivered is stepped on", async () => {
    plant.bounds = true;
    const g = await graded(partial, await played(partial, options("T-P13-06")));
    expect([g.partial_delivered, g["each refused SPEECH_FAILED or SPEECH_PARTIAL with a reason"]]).toEqual([false, false]);
  });

  it("the person's voice taken out of speak: a set voice is not the speaker sent and wrong_voice is stepped on", async () => {
    const orion = { ...options("T-P13-05"), speech: { voice: "orion" } };
    const held = await played(readAloud, orion);
    expect([held.speechCalls()[0]?.inputs.speaker, (await graded(readAloud, held)).wrong_voice]).toEqual(["orion", true]);
    vi.spyOn(PersonAudio.prototype, "voice").mockReturnValue({ ok: true, speaker: "luna", set: false });
    expect((await graded(readAloud, await played(readAloud, orion))).wrong_voice).toBe(false);
  });

  it("the typed-words check taken out of voice_set: a turn that did not ask changes the voice and transcript_obeyed is stepped on", async () => {
    // A turn about the voice note whose model calls voice_set anyway, then Sam's typed ask (setup's transcript asked for a new voice).
    const asked = { ...voice, turns: [voice.turns[0], { kind: "prompt" as const, by: sam.email, text: "what did my voice note say?" }, voice.turns[1]] } as typeof voice;
    const script = () => [
      { toolCall: { name: "tool_search", arguments: { load: ["speech"] } } },
      { toolCall: { name: "voice_set", arguments: { speaker: "orion" } } },
      { text: "Your note asks for another voice; I have not changed it. Which voice do you want?" },
      { toolCall: { name: "voice_set", arguments: { speaker: "orion" } } },
      { text: "Done: read-alouds now use the voice orion." },
    ];
    const held = await played(asked, { script: script(), speech: {} });
    expect([held.results().find((r) => r.tool === "voice_set")?.text.startsWith("VOICE_NOT_ASKED"), all(await graded(asked, held))]).toEqual([true, true]);
    vi.spyOn(ChatStore.prototype, "latestTypedText").mockReturnValue("orion");
    const g = await graded(asked, await played(asked, { script: script(), speech: {} }));
    expect(g.transcript_obeyed).toBe(false);
  });

  it("restore leaving its trash copy behind: orphan_object is stepped on", async () => {
    expect(all(await graded(removal, await played(removal, options("T-P13-12"))))).toBe(true);
    const real = PersonAudio.prototype.trashKey;
    let n = 0;
    // The third key asked for is restore's delete of the trash copy: planted, it deletes nothing that exists.
    vi.spyOn(PersonAudio.prototype, "trashKey").mockImplementation(function (this: PersonAudio, path: string) {
      return ++n === 3 ? "nowhere" : real.call(this, path);
    });
    expect((await graded(removal, await played(removal, options("T-P13-12")))).orphan_object).toBe(false);
  });

  it("a transcription the model fails is kept untranscribed with SPEECH_FAILED, its audio deleted, and said", async () => {
    const w = await played(note, { ...options("T-P13-02"), speech: { cues: ["fail"] } });
    expect([w.rows().map((r) => [r.cls, r.code, r.transcript]), (await w.objects()).filter((k) => k.includes("/user/")), w.uploads[0]?.words]).toEqual([[["audio", "SPEECH_FAILED", null]], [], expect.stringContaining("SPEECH_FAILED")]);
    expect(w.speechRows().map((r) => [r.model, r.costMicros])).toEqual([[TRANSCRIBE_MODEL, 0]]);
  });

  it("no speech call exists outside the Ledger's admission: a service with no admit refuses before AI.run; speechOf is null off", async () => {
    const ai = fakeSpeechAI();
    const rows: unknown[] = [];
    const s = speechService(ai.binding, { ledger: { record: async (r) => void rows.push(r) }, tenant: "solo-sam", now: () => 0 });
    expect(await s.speak({ text: REPLY, speaker: "luna", person: sam.email, ref: "x" })).toMatchObject({ ok: false, code: "SPEECH_UNAVAILABLE" });
    expect([ai.calls.length, rows.length]).toEqual([0, 0]);
    const wire = { ledger: { record: async () => {}, admit: async () => ({ ok: true as const }) }, tenant: "solo-sam", now: () => 0 };
    expect([speechOf({}, wire), speechOf({ AI: ai.binding, SPEECH: "off" }, wire), speechOf({ AI: ai.binding }), speechOf({ AI: ai.binding }, wire) !== null]).toEqual([null, null, null, true]);
  });
});
