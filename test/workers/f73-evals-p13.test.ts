// F73: T-P13-14 on a preview slot. The `p13` op (`scripts/preview-slot/test-host-p13.mjs`) speaks the fixture sentence
// through the slot's own speech service, so the runner's voice note is generated, never a recording of a person, and
// reads Sam's attachment rows with their transcripts, her audio records and the Ledger's speech calls; the readers
// (`scripts/evals/p13-slot.ts`) set the slot's speech cap to $1 and read it back before each trial, upload the probe as
// Sam's voice note for the next prompt to carry, and hold only what the trial made. Hermetic: the readers run over Sam's
// real chat and attachments in the P13 tier-1 world with speech on over the fake binding, the rows read from the
// Durable Objects' own SQLite by the op's code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { P13_SPEECH_CAP_MICROS, type P13App, type P13Op, type P13Probe, type P13State, p13Slot } from "../../scripts/evals/p13-slot.ts";
import { CLUSTER_EVENTS, driveable } from "../../scripts/evals/runner.ts";
import { p13PersonRows, p13Probe, p13SpeechCalls } from "../../scripts/preview-slot/test-host-p13.mjs";
import { type P13Tier1World, p13Harness, sam } from "../evals/p13-voice-audio/harness.ts";
import live from "../evals/p13-voice-audio/live-round-trip.task.ts";
import type { P13World } from "../evals/p13-voice-audio/world.ts";
import { PROBE_FILE, SPEAK_MODEL, silentMp3, TRANSCRIPT, TRANSCRIBE_MODEL } from "../evals/p13-voice-audio/world.ts";
import { InfraError, type SlotWorld } from "../support/evals.ts";
import type { FakeStep } from "../support/fake-model.ts";
import type { DefinedTask } from "../support/task.ts";
import { Seeded } from "../support/seeded.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Array<Record<string, unknown>> } };
const sqlOf = (h: { rows(q: string, ...b: never[]): Array<Record<string, unknown>> }): Sql => ({ exec: (q, ...b) => ({ toArray: () => h.rows(q, ...(b as never[])) }) });

/** The `p13` op's read over the tier-1 world: Sam's attachments and audio records, and the Ledger's speech calls, by the op's code. */
function readOf(w: P13Tier1World): P13State {
  const person = sqlOf(w.w.personHarness(sam.email) as never);
  const attachments = sqlOf(w.a.harness(sam.email) as never);
  const ledger = sqlOf(w.w.objects().find(([n]) => n === "ledger")?.[1] as never);
  return { rows: p13PersonRows(attachments).rows, audio: p13PersonRows(person).audio, calls: p13SpeechCalls(ledger) };
}

/** Sam's app as the slot answers it: the cap the admin route keeps, and uploads recorded. */
function appOf(cap: { set: number; reads?: number }, uploads: Array<{ name: string; type: string; bytes: Uint8Array }> = []): P13App {
  return {
    async json(method, path, body) {
      if (method === "PUT" && path === "/admin/settings") cap.set = (body as { budgets: { tenantSpeechMonthlyMicros: number } }).budgets.tenantSpeechMonthlyMicros;
      return { status: 200, body: { settings: { budgets: { tenantSpeechMonthlyMicros: cap.reads ?? cap.set } } } };
    },
    async upload(name, type, bytes) {
      uploads.push({ name, type, bytes });
      return { status: 201, body: { ok: true, attachment: { id: `att-${uploads.length}` }, words: `${name} is attached as its transcript; its audio was not kept.` } };
    },
  };
}

const opOver = (read: () => P13State, probe: P13Probe = { ok: true, audio: "", ms: 0 }): P13Op => (async (call: string) => (call === "read" ? read() : probe)) as unknown as P13Op;

/** The model's answers for T-P13-14 under the fake: load speech, speak the note's words verbatim, say it is ready. */
const script = (text = TRANSCRIPT): FakeStep[] => [{ toolCall: { name: "tool_search", arguments: { load: ["speech"] } } }, { toolCall: { name: "speak", arguments: { text, topics: ["picnic"] } } }, { text: "Here is your voice note, read back." }];

const verdicts = async (w: P13World) => {
  const out: Record<string, boolean> = {};
  for (const g of live.graders) out[g.name] = await g.check(w);
  return out;
};
const allHeld = Object.fromEntries(live.graders.map((g) => [g.name, true]));

/** T-P13-14 played in the tier-1 world with the slot's readers begun before the turns (or after them, planted), graded over them. */
async function overSlot(opts: { text?: string; beginAfter?: boolean; edit?: (s: P13State) => P13State } = {}) {
  const task = live as unknown as DefinedTask<P13World>;
  const h = p13Harness({ script: script(opts.text), speech: {} });
  const rng = new Seeded(task.setup.seed);
  const w = (await h.setup(rng, task)) as P13Tier1World;
  const s = p13Slot(opOver(() => (opts.edit ?? ((x) => x))(readOf(w))), appOf({ set: 0 }));
  if (!opts.beginAfter) await s.begin();
  for (const t of task.turns) await h.play(w, t, rng);
  if (opts.beginAfter) await s.begin();
  await s.refresh();
  return { s, w: s.readers as unknown as P13World };
}

describe("[F73] P13 on a slot: the probe spoken by the slot, the voice note, the $1 cap and the trial's own rows", () => {
  it("every P13 version_hash in the contract is its file's hash, T-P13-14's refined graders included", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P13-voice-audio.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    // The draft's hash moved with the refined graders (under Node's loader, as the runner computes it).
    expect(/T-P13-14 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1]).not.toBe("048998d3889b");
  });

  it("drives T-P13-14 (a voice note, then Sam's prompt); a voice-note event in another cluster is not driven", () => {
    expect(driveable(live as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    expect(CLUSTER_EVENTS.P13).toEqual(["voice-note"]);
    // Planted: the same turns under a cluster with no voice-note event are refused by name before any trial.
    expect(driveable({ ...live, cluster: "P16" } as unknown as DefinedTask<SlotWorld>, sam.email)).toMatch(/^EVALS_TASK_UNDRIVABLE: turn 1 of T-P13-14 is the event voice-note/);
  });

  it("the probe is the fixture sentence spoken by the slot's speech in the voice given, as base64; a refusal keeps its code", async () => {
    const asked: unknown[] = [];
    const bytes = silentMp3(150);
    const ok = await p13Probe({ speak: async (i: unknown) => (asked.push(i), { ok: true as const, bytes, ms: 3918 }) }, sam.email, "luna");
    expect(asked).toEqual([{ text: TRANSCRIPT, speaker: "luna", person: sam.email, ref: "p13-probe" }]);
    expect(ok.ok && Uint8Array.from(atob(ok.audio), (c) => c.charCodeAt(0))).toEqual(bytes);
    expect(await p13Probe({ speak: async () => ({ ok: false as const, code: "SPEECH_BUDGET_EXHAUSTED", reason: "spent" }) }, sam.email, "luna")).toEqual({ ok: false, code: "SPEECH_BUDGET_EXHAUSTED", reason: "spent" });
    expect(await p13Probe(null, sam.email, "luna")).toMatchObject({ ok: false, code: "SPEECH_UNAVAILABLE" });
  });

  it("voice-note: the probe uploaded as Sam's p13-probe.mp3 and carried once by the next prompt; a probe the slot cannot speak is infra", async () => {
    const uploads: Array<{ name: string; type: string; bytes: Uint8Array }> = [];
    const bytes = silentMp3(4);
    const audio = btoa(String.fromCharCode(...bytes));
    const s = p13Slot(opOver(() => ({ rows: [], audio: [], calls: [] }), { ok: true, audio, ms: 104 }), appOf({ set: 0 }, uploads));
    await s.begin();
    expect(await s.event("reload", {})).toBe(false);
    expect(await s.event("voice-note", { name: PROBE_FILE })).toBe(true);
    expect(uploads).toEqual([{ name: PROBE_FILE, type: "audio/mpeg", bytes }]);
    expect((s.readers as unknown as P13World).uploads).toEqual([{ name: PROBE_FILE, status: 201, words: `${PROBE_FILE} is attached as its transcript; its audio was not kept.` }]);
    expect([s.take(), s.take()]).toEqual([["att-1"], []]);
    const refused = p13Slot(opOver(() => ({ rows: [], audio: [], calls: [] }), { ok: false, code: "SPEECH_FAILED", reason: "x" }), appOf({ set: 0 }));
    await expect(refused.event("voice-note", {})).rejects.toMatchObject({ code: "SLOT_5XX" });
    await expect(refused.event("voice-note", {})).rejects.toBeInstanceOf(InfraError);
  });

  it("each trial sets the slot's speech cap to $1 and reads it back; a cap that reads above $1 stops the trial as the slot's", async () => {
    const cap = { set: 0 };
    await p13Slot(opOver(() => ({ rows: [], audio: [], calls: [] })), appOf(cap)).begin();
    expect([cap.set, P13_SPEECH_CAP_MICROS]).toEqual([1_000_000, 1_000_000]);
    // Planted: the deploy's $5 default still in force after the write.
    await expect(p13Slot(opOver(() => ({ rows: [], audio: [], calls: [] })), appOf({ set: 0, reads: 5_000_000 })).begin()).rejects.toMatchObject({ code: "SLOT_5XX" });
  });

  it("the readers answer T-P13-14 as the tier-1 world does: both graders hold under the scripted fake, and the Ledger prices the trial's speech", async () => {
    const { s, w } = await overSlot();
    expect(await verdicts(w)).toEqual(allHeld);
    expect(w.rows().map((r) => [r.cls, r.transcript])).toEqual([["audio", TRANSCRIPT]]);
    expect((w.speechRows?.() ?? []).map((r) => r.model)).toEqual([TRANSCRIBE_MODEL, SPEAK_MODEL]);
    const spent = s.spend();
    expect(spent.calls).toBe(2);
    expect(spent.micros).toBe((w.speechRows?.() ?? []).reduce((n, r) => n + r.costMicros, 0));
    expect(spent.micros).toBeGreaterThan(0);
  });

  it("planted: rows there before the trial, a paraphrased read-back, a render outside the text's bounds and a removed record each fail", async () => {
    // What an earlier trial left is no pass for this one.
    expect(await verdicts((await overSlot({ beginAfter: true })).w)).toEqual(Object.fromEntries(live.graders.map((g) => [g.name, false])));
    const second = live.graders[1]?.name as string;
    expect((await verdicts((await overSlot({ text: "Sam and Pat are going on a picnic." })).w))[second]).toBe(false);
    const edit = (f: (a: P13State["audio"][number]) => P13State["audio"][number]) => (s: P13State) => ({ ...s, audio: s.audio.map(f) });
    expect((await verdicts((await overSlot({ edit: edit((a) => ({ ...a, durationMs: 900 })) })).w))[second]).toBe(false);
    expect((await verdicts((await overSlot({ edit: edit((a) => ({ ...a, durationMs: 60_000 })) })).w))[second]).toBe(false);
    expect((await verdicts((await overSlot({ edit: edit((a) => ({ ...a, removed: true })) })).w))[second]).toBe(false);
    // A transcript that lost a name fails the first.
    const lost = (await overSlot({ edit: (s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, transcript: (r.transcript ?? "").replace("Pat Solo", "Pat") })) }) })).w;
    expect((await verdicts(lost))[live.graders[0]?.name as string]).toBe(false);
  });
});
