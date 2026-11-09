// Every guard F70 adds, planted (KICKOFF, "Plant the guard"): each is taken out of the production path and the task
// grader or the check that holds it fails. The refusals (`speak`'s SPEECH_UNAVAILABLE, `speech_status`'s
// VOICE_CALL_UNAVAILABLE) are taken out of the namespace `chat/session.ts` builds for every chat; the audio class is taken
// out of `ATTACHMENT_TYPES`, the cap out of the route's caps, the audio's deletion out of the bucket, the untranscribed
// row's code out of the store, the transcript column out of the migrations, the WORK_WORDS line out of the prefix, and a
// capture tool and route are planted in the sources. T-P13-04's `dictated_audio_kept` is planted in Chromium, in
// `dictation-is-text.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_TYPES, AUDIO_MAX, CAPS } from "../../../packages/agent/src/attachments/caps.ts";
import { attachmentKey, PersonAttachments } from "../../../packages/agent/src/attachments/store.ts";
import { HARNESS_MIGRATIONS } from "../../../packages/agent/src/migrations/catalog.ts";
import { migrate } from "../../../packages/agent/src/migrations/engine.ts";
import type { Speech } from "../../../packages/agent/src/speech/speech.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { attachmentWorld } from "../../workers/support/attachment-world.ts";
import { asBucket, FakeR2 } from "../../workers/support/fake-r2.ts";
import call from "./call-retention-declared.task.ts";
import { graded, p13Harness, played, sam } from "./harness.ts";
import capture from "./no-agent-started-capture.task.ts";
import off from "./no-speech-refused-by-name.task.ts";
import { runs } from "./runs.ts";
import { fakeSpeechAI, framesOf, PROBE_FILE, probeNote, silentMp3, TRANSCRIBE_MODEL, TRANSCRIPT } from "./world.ts";

const plant = vi.hoisted(() => ({ speak: false, call: false }));
const said = (text: string) => async () => ({ content: [{ type: "text" as const, text }], details: {} });
vi.mock("../../../packages/agent/src/speech/tools.ts", async (original) => {
  const m = await original<typeof import("../../../packages/agent/src/speech/tools.ts")>();
  return {
    ...m,
    speechNamespace: (...args: Parameters<typeof m.speechNamespace>) => {
      const ns = m.speechNamespace(...args);
      return { ...ns, tools: ns.tools.map((t) => (plant.speak && t.name === "speak" ? { ...t, execute: said("Read aloud.") } : plant.call && t.name === "speech_status" ? { ...t, execute: said("calls: on") } : t)) };
    },
  };
});

const offWorld = (p?: Parameters<typeof played>[2]) => played(off, { script: runs["T-P13-13"]!() }, p);

describe("[F70] P13 voice and audio: each guard planted", () => {
  it("unplanted, T-P13-13 holds every grader", async () => {
    expect(Object.values(await graded(off, await offWorld())).every(Boolean)).toBe(true);
  });

  it("speak's refusal taken out: the read-aloud is a silent text reply and the graders fail", async () => {
    plant.speak = true;
    try {
      const g = await graded(off, await offWorld());
      expect([g["the read-aloud and the episode were refused SPEECH_UNAVAILABLE with a reason"], g.silent_text_reply]).toEqual([false, false]);
    } finally {
      plant.speak = false;
    }
  });

  it("speech_status's call refusal taken out: T-P13-11's refusal grader fails and the reply steps on call_promised", async () => {
    plant.call = true;
    try {
      const g = await graded(call, await played(call, { script: runs["T-P13-11"]!() }));
      // The reply reads the tool's answer (runs.ts): with no refusal to read, it promises the call and steps on call_promised.
      expect([g["both asks reached speech_status, which refused the call by name with its reason"], g.call_promised]).toEqual([false, false]);
    } finally {
      plant.call = false;
    }
  });

  it("the audio class missing from ATTACHMENT_TYPES: the voice note is refused, no row is kept, and the grader fails", async () => {
    const mp3 = ATTACHMENT_TYPES.mp3;
    delete ATTACHMENT_TYPES.mp3;
    try {
      const w = await offWorld();
      expect(w.uploads[0]?.code).toBe("ATTACHMENT_TYPE_UNSUPPORTED");
      expect((await graded(off, w))["the voice note's row is kept with SPEECH_UNAVAILABLE and no transcript"]).toBe(false);
    } finally {
      ATTACHMENT_TYPES.mp3 = mp3 as (typeof ATTACHMENT_TYPES)[string];
    }
  });

  it("the audio cap: an mp3 over AUDIO_MAX is refused before storage by name; with the cap taken out it is stored", async () => {
    const big = silentMp3(Math.ceil((AUDIO_MAX + 1) / 417));
    const capped = attachmentWorld();
    const r = await capped.upload(sam.email, "p13-big.mp3", big, { type: "audio/mpeg" });
    expect([r.status, r.body.code, /8 MB/.test(String(r.body.words)), (await capped.r2.list({})).objects.length]).toEqual([413, "ATTACHMENT_TOO_LARGE_AUDIO", true, 0]);
    const uncapped = attachmentWorld({ caps: { ...CAPS, audio: CAPS.file } });
    expect((await uncapped.upload(sam.email, "p13-big.mp3", big, { type: "audio/mpeg" })).status).toBe(201);
  });

  it("the audio's deletion taken out of the bucket: the object stays and T-P13-13's grader fails", async () => {
    const w = await offWorld((x) => {
      (x.a.r2 as unknown as { delete: () => Promise<void> }).delete = async () => {};
    });
    const g = await graded(off, w);
    expect([g["the voice note's audio is not kept in any bucket"], g.empty_file]).toEqual([false, false]);
  });

  it("the SPEECH_UNAVAILABLE marking taken out of the store: the row says nothing, and empty_file and the row grader fail", async () => {
    const w = await offWorld((x) => {
      // The store's own SQL with the untranscribed row's `UPDATE attachments SET code` dropped, every other statement run.
      const store = x.a.store(sam.email) as unknown as { storage: { sql: SqlStorage } };
      const sql = store.storage.sql;
      store.storage = { sql: { exec: (q: string, ...a: unknown[]) => (/^UPDATE attachments SET code = \?/.test(q) ? sql.exec("SELECT 1 WHERE 0") : sql.exec(q, ...a)) } as unknown as SqlStorage };
    });
    expect(w.rows().map((r) => [r.cls, r.code, r.transcript])).toEqual([["audio", null, null]]);
    const g = await graded(off, w);
    expect([g["the voice note's row is kept with SPEECH_UNAVAILABLE and no transcript"], g.empty_file]).toEqual([false, false]);
  });

  it("the transcript column: a transcribed note keeps its transcript on its row; without the migration the write fails", async () => {
    const ai = fakeSpeechAI();
    const speech: Speech = { transcribe: async (i) => ({ ok: true, text: String(((await ai.binding.run(TRANSCRIBE_MODEL, { audio: [...i.bytes] })) as { text: string }).text) }), speak: async () => ({ ok: false, code: "SPEECH_UNAVAILABLE", reason: "this test transcribes only" }) };
    const keep = async (list: typeof HARNESS_MIGRATIONS) => {
      const r2 = new FakeR2();
      const bytes = probeNote();
      const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      await asBucket(r2).put(attachmentKey(sam.email, sha), bytes);
      const h = new ObjectHarness("p13-transcript", (ctx) => {
        migrate((ctx as DurableObjectState).storage as never, list);
        return new PersonAttachments((ctx as DurableObjectState).storage, { person: sam.email, bucket: asBucket(r2) as never, ingest: async () => ({ ok: false, code: "X", reason: "x" }), describe: () => "", convert: null, now: () => 0, speech });
      }, {});
      h.autoMigrate = false;
      const r = (await h.instance.call(sam.email, { op: "record", sha256: sha, name: PROBE_FILE, mime: "audio/mpeg", size: bytes.byteLength, cls: "audio" })) as { ok: boolean };
      return { ok: r.ok, rows: h.rows("SELECT * FROM attachments"), objects: (await r2.list({})).objects.length };
    };
    const kept = await keep(HARNESS_MIGRATIONS);
    expect([kept.ok, kept.rows[0]?.transcript, kept.rows[0]?.status, kept.objects, ai.calls.length]).toEqual([true, TRANSCRIPT, "read", 0, 1]);
    await expect(keep(HARNESS_MIGRATIONS.filter((m) => m.name !== "person.attachments-transcript"))).rejects.toThrow(/transcript/);
  });

  it("the fake speech binding answers both models, fails and cuts short on cue", async () => {
    const ai = fakeSpeechAI(["ok", "ok", "fail", "short"]);
    expect(await ai.binding.run(TRANSCRIBE_MODEL, {})).toMatchObject({ text: TRANSCRIPT });
    expect(framesOf((await ai.binding.run("@cf/deepgram/aura-2-en", {})) as Uint8Array)).toBe(200);
    await expect(ai.binding.run("@cf/deepgram/aura-2-en", {})).rejects.toThrow(/failed/);
    expect(framesOf((await ai.binding.run("@cf/deepgram/aura-2-en", {})) as Uint8Array)).toBe(2);
  });

  it("the WORK_WORDS line taken out of the prefix: T-P13-11's prefix grader fails", async () => {
    const w = await played(call, { script: runs["T-P13-11"]!() });
    const prefix = w.prefix();
    w.prefix = () => prefix.split("\n").filter((l) => !l.includes("this deploy has no voice calls")).join("\n");
    expect((await graded(call, w))["the prefix carries the one line that says there are no voice calls and nothing is kept"]).toBe(false);
  });

  it("a capture tool or a capture route planted in the sources: T-P13-01's graders fail", async () => {
    const tool = { file: "planted/mic.ts", text: 'const spec = {\n  name: "mic_open",\n  kind: "observation",\n};' };
    const route = { file: "http/planted.ts", text: 'if (url.pathname === "/app/voice") return start();' };
    for (const [file, name] of [[tool, "no listed or declared tool's name opens a microphone, starts dictation or starts a call"], [route, "no route path starts capture or a call server-side"]] as const) {
      const g = await graded(capture, await played(capture, { script: runs["T-P13-01"]!(), plantSources: (fs) => [...fs, file] }));
      expect([g[name], g.capture_tool]).toEqual([false, false]);
    }
  });

  it("the harness serves a run as the task file names it", () => {
    expect(typeof p13Harness({ script: [] }).setup).toBe("function");
  });
});
