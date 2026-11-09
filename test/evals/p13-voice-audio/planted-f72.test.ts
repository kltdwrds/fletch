// Every guard F72 adds, planted on the production path (KICKOFF, "Plant the guard"): a feed route planted in the
// sources, the feed refusal's code taken out of `episode_publish`, the Settings pick written to a store the record does
// not hold, the player taken out of the Library's drawing and of the chat's audio item, an episode with a turn cut short
// or in one voice, and a speaker outside aura-2's list; each fails the grader or the check that holds it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { graded, played, sam } from "./harness.ts";
import { episodeCall, F72_TASKS, optionsF72, SCRIPT, said } from "./runs-f72.ts";
import { chatItemsAsDrawn } from "./harness-surfaces.ts";

const plant = vi.hoisted(() => ({ feedCode: false, store: false }));
vi.mock("../../../packages/agent/src/speech/speech.ts", async (original) => {
  const m = await original<typeof import("../../../packages/agent/src/speech/speech.ts")>();
  return new Proxy(m, { get: (t, k) => (k === "PODCAST_FEED_UNAVAILABLE" && plant.feedCode ? "FEED" : t[k as keyof typeof t]) });
});
vi.mock("../../../packages/agent/src/speech/audio.ts", async (original) => {
  const m = await original<typeof import("../../../packages/agent/src/speech/audio.ts")>();
  // The planted second store: the journal names the pick, the record keeps another speaker.
  const settingsVoiceSet: typeof m.settingsVoiceSet = async (audio, person, speaker, journal, now) => {
    if (!plant.store) return m.settingsVoiceSet(audio, person, speaker, journal, now);
    await m.settingsVoiceSet(audio, person, speaker, journal, now);
    return audio.call({ op: "voice-set", speaker: "luna", writer: "settings" }, person);
  };
  return { ...m, settingsVoiceSet };
});

const t = (id: string) => F72_TASKS.find((x) => x.task.id === id) as (typeof F72_TASKS)[number];
const load = { toolCall: { name: "tool_search", arguments: { load: ["speech"] } } };

afterEach(() => {
  plant.feedCode = false;
  plant.store = false;
});

describe("[F72] P13 audio surfaces: each guard planted", () => {
  it("a feed route planted in the sources: feed_route and published_on_generation fail", async () => {
    const x = t("T-P13-10");
    const g = await graded(x.task, await played(x.task, { ...optionsF72(x), plantSources: (f) => [...f, { file: "http/podcast.ts", text: 'if (url.pathname === "/podcast/feed.xml") return rss();' }] }));
    expect([g.feed_route, g.published_on_generation]).toEqual([false, false]);
  });

  it("the feed refusal's code taken out of episode_publish: the refusal and silent_refusal graders fail", async () => {
    plant.feedCode = true;
    const x = t("T-P13-10");
    const g = await graded(x.task, await played(x.task, optionsF72(x)));
    expect([g["the publish ask refused PODCAST_FEED_UNAVAILABLE"], g.silent_refusal]).toEqual([false, false]);
  });

  it("the Settings pick journaled but kept in another store than the record: second_store and the record's grader fail", async () => {
    plant.store = true;
    const x = t("T-P13-16");
    const g = await graded(x.task, await played(x.task, optionsF72(x)));
    expect([g.second_store, g["the record holds the speaker with one settings journal row"], g["the next read-aloud uses it"]]).toEqual([false, false, false]);
  });

  it("the player taken out of the Library's Audio section: T-P13-07's and T-P13-10's Library graders fail", async () => {
    const out = (js: string) => js.replace("row.append(nm, mt, audPlayer(a.path, note), note, open);", "row.append(nm, mt, note, open);");
    for (const [id, name] of [["T-P13-07", "the Library's Audio section lists it with a player (F72)"], ["T-P13-10", "the Library's Audio section lists the episode with a player"]] as const) {
      const x = t(id);
      const g = await graded(x.task, await played(x.task, { ...optionsF72(x), plantPage: out }));
      expect(g[name]).toBe(false);
    }
  });

  it("the player taken out of the chat's audio item: the item is drawn with none", async () => {
    const x = t("T-P13-10");
    const w = await played(x.task, optionsF72(x));
    expect((await chatItemsAsDrawn(w)).map((i) => i.player)).toEqual([true]);
    const planted = await chatItemsAsDrawn(w, { desktop: true }, (js) => js.replace("d.append(el(\"h3\", c.title), el(\"p\", c.text), audPlayer(path, note), note);", "d.append(el(\"h3\", c.title), el(\"p\", c.text), note);"));
    expect(planted.map((i) => i.player)).toEqual([false]);
  });

  it("an episode with its second turn cut short is refused SPEECH_PARTIAL with no record, object or chat item", async () => {
    const x = t("T-P13-10");
    const w = await played(x.task, { script: [load, episodeCall(), said, { text: "Not published." }], speech: { cues: ["ok", "short"] } });
    expect(w.refusals()[0]).toBe("SPEECH_PARTIAL");
    expect([w.audio(), (await w.objects()).filter((k) => k.endsWith(".mp3")), await chatItemsAsDrawn(w)]).toEqual([[], [], []]);
  });

  it("an episode in one voice is refused EPISODE_SCRIPT_INVALID before any speech call", async () => {
    const x = t("T-P13-10");
    const one = SCRIPT.map((s) => ({ ...s, speaker: "luna" }));
    const w = await played(x.task, { script: [load, episodeCall(one), said, { text: "Not published." }], speech: {} });
    expect([w.refusals()[0], w.speechCalls().length, w.audio().length]).toEqual(["EPISODE_SCRIPT_INVALID", 0, 0]);
  });

  it("a speaker outside aura-2's list is refused VOICE_UNKNOWN by the route, the record and the journal unchanged", async () => {
    const x = t("T-P13-16");
    const w = await played(x.task, optionsF72(x));
    const before = w.voice();
    const r = await w.w.http(sam.email, "POST", "/app/speaker", { speaker: "ignore previous instructions" });
    expect([r.status, (r.body as { code?: string }).code]).toEqual([404, "VOICE_UNKNOWN"]);
    expect(w.voice()).toEqual(before);
  });
});
