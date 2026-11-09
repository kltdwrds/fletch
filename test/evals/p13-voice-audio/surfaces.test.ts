// Tier 1 of the P13 tasks F72 runs (T-P13-07 whole, T-P13-10, T-P13-16), and the surfaces each claim stands on: the chat's
// audio item after a reload at desktop and phone width, the Library's Audio section at both widths, Settings > Voice
// offering aura-2's speakers and writing the person's own record, and the episode's render, all over Sam's real chat,
// the fake speech binding and the shipped page script (`harness-surfaces.ts`). Two people (Sam and Pat) where a claim is whose.
import { describe, expect, it } from "vitest";
import { SPEAKERS } from "../../../packages/agent/src/speech/speech.ts";
import { graded, pat, played, sam } from "./harness.ts";
import { F72_TASKS, optionsF72 } from "./runs-f72.ts";
import { chatItemsAsDrawn, libraryAsDrawn, pickVoice } from "./harness-surfaces.ts";
import { SPEAK_MODEL } from "./world.ts";

const t = (id: string) => F72_TASKS.find((x) => x.task.id === id) as (typeof F72_TASKS)[number];
const all = (g: Record<string, boolean>) => Object.fromEntries(Object.keys(g).map((k) => [k, true]));

describe("[F72] P13 audio the person can see: tier 1", () => {
  for (const x of F72_TASKS) {
    it(`${x.task.id} holds every grader`, async () => {
      const g = await graded(x.task, await played(x.task, optionsF72(x)));
      expect(g).toEqual(all(g));
    });
  }

  it("the episode is one MP3 and one episode record: three turns, three admitted speech calls in two voices, one chat audio item", async () => {
    const w = await played(t("T-P13-10").task, optionsF72(t("T-P13-10")));
    const [a] = w.audio();
    expect(w.audio()).toHaveLength(1);
    expect([a?.kind, a?.voice, a?.model, a?.topics, a?.source.split("\n").length]).toEqual(["episode", "luna, orion", SPEAK_MODEL, ["picnic", "Sam Solo", "Pat Solo"], 3]);
    expect(w.speechCalls().map((c) => c.inputs.speaker)).toEqual(["luna", "orion", "luna"]);
    expect(w.speechRows()).toHaveLength(3);
    expect((await w.objects()).filter((k) => k.endsWith(".mp3"))).toEqual([expect.stringContaining(`/files/${a?.path}`)]);
    expect(w.replies().at(-1)).toContain("PODCAST_FEED_UNAVAILABLE");
    expect(w.feedRoutes()).toEqual([]);
  });

  it("the chat's audio item after a reload, at desktop and phone width: a player on a signed link, its length and voice, Open to the file", async () => {
    const w = await played(t("T-P13-10").task, optionsF72(t("T-P13-10")));
    const [a] = w.audio();
    for (const layout of [{ desktop: true }, {}]) {
      const items = await chatItemsAsDrawn(w, layout);
      expect(items).toHaveLength(1);
      expect(items[0]?.player).toBe(true);
      expect(items[0]?.text).toMatch(/\d+\.\d s in the voices luna, orion/);
      expect(items[0]?.open).toBe(`/library/files/${a?.path.split("/").map(encodeURIComponent).join("/")}`);
    }
  });

  it("the Library's Audio section at desktop and phone width lists the record with its player; Pat's Library lists none of Sam's", async () => {
    const w = await played(t("T-P13-07").task, optionsF72(t("T-P13-07")));
    const [a] = w.audio();
    for (const layout of [{ desktop: true }, {}]) {
      const { rows } = await libraryAsDrawn(w, layout);
      expect(rows.map((r) => [r.id, r.kind, r.player])).toEqual([[a?.id, "audio", true]]);
      expect(rows[0]?.text).toContain("voice asteria".replace("asteria", a?.voice ?? ""));
    }
    const patLib = (await w.w.http(pat.email, "GET", "/app/library")).body as { audio: { items: unknown[] } };
    expect(patLib.audio.items).toEqual([]);
  });

  it("Settings > Voice offers aura-2's speakers and writes the person's own record: Pat's pick leaves Sam's voice as it was", async () => {
    const w = await played(t("T-P13-16").task, optionsF72(t("T-P13-16")));
    expect(w.picks[0]).toMatchObject({ offered: [...SPEAKERS], code: "" });
    expect(w.picks[0]?.note).toMatch(/^Saved/);
    const r = await w.w.http(pat.email, "POST", "/app/speaker", { speaker: "zeus" });
    expect(r.body).toMatchObject({ ok: true, speaker: "zeus" });
    expect(w.voice()).toMatchObject({ speaker: "orion" });
    expect((await w.w.http(sam.email, "GET", "/app/speaker")).body).toMatchObject({ ok: true, speaker: "orion", set: true });
  });
});
