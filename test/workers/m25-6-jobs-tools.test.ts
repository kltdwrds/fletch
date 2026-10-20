// M25.6: the jobs tools. `jobs_create` refuses a url gate on a host a job cannot read, with a code and words,
// before anything is registered; `jobs_remove` asks the person on a card and then archives the job;
// the cap counts only jobs that are not finished or removed. The scripted fake drives the real chat engine,
// cards and `Job` engines; Ada and Bo of solo-sam.
import { describe, expect, it } from "vitest";
import { gateHostRefusal, MAX_JOBS } from "../../packages/agent/src/jobs/tools.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

type World = ReturnType<typeof authorityWorld>;
const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
const create = (args: Record<string, unknown>, id = "c1"): FakeStep => ({ toolCall: { id, name: "jobs_create", arguments: { title: "Site watch", instructions: "Tell me when the site changes.", schedule: { kind: "interval", every_minutes: 30 }, ...args } } });
const remove = (jobId: string, id = "x1"): FakeStep => ({ toolCall: { id, name: "jobs_remove", arguments: { id: jobId } } });
const list: FakeStep = { toolCall: { id: "ls", name: "jobs_list", arguments: {} } };
const open = async (w: World, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;
const said = (w: World, p: string) => w.transcriptOf(p).join("\n");
const approve = async (w: World, chat: string, p: string) => {
  for (const card of w.cardsOf(p)) await w.chats.harness(chat).instance.decide([card.id], { person: p, agent: false }, "once");
};

describe("[M25.6] refuse at create", () => {
  it("a url gate on a public site is registered; an IP literal, a platform host, a private name and a port are refused with JOB_GATE_HOST_DENIED", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const gate = (url: string) => ({ gate: { kind: "url", url } });
    w.fake.enqueue(
      load,
      create({ title: "Public", ...gate("https://example.com/news") }),
      create({ title: "Literal", instructions: "Watch the literal.", ...gate("https://203.0.113.9/") }, "c2"),
      create({ title: "Platform", instructions: "Watch the platform.", ...gate("https://tenant.workers.dev/") }, "c3"),
      create({ title: "Private", instructions: "Watch the private.", ...gate("https://wiki.internal/") }, "c4"),
      create({ title: "Port", instructions: "Watch the port.", ...gate("https://example.com:8443/") }, "c5"),
      { text: "Done." },
    );
    await w.say(ada.email, "Set five watches.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(1);
    expect(await w.jobOf(ada.email, w.jobIds(ada.email)[0] as string).instance.status()).toMatchObject({ def: { gate: { url: "https://example.com/news" } } });
    const t = said(w, ada.email);
    expect(t.match(/JOB_GATE_HOST_DENIED/g)).toHaveLength(4);
    expect(t).toContain("a job can watch any public https website by its name");
  });

  it("watermark and threshold gates are checked the same way", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ title: "Count", gate: { kind: "watermark", url: "https://203.0.113.9/count.json", pointer: "/n" } }),
      create({ title: "Score", instructions: "Watch the score.", gate: { kind: "threshold", url: "https://app.qyvr.ai/score.json", pointer: "/n", above: 3 } }, "c2"),
      { text: "Done." },
    );
    await w.say(ada.email, "Set two watches.", chat);
    expect(w.jobIds(ada.email)).toEqual([]);
    expect(said(w, ada.email).match(/JOB_GATE_HOST_DENIED/g)).toHaveLength(2);
  });

  it("the check is the policy cap and fetches nothing", () => {
    expect(gateHostRefusal({ kind: "url", url: "https://example.com/a?b=c" })).toBeNull();
    expect(gateHostRefusal({ kind: "url", url: `https://user:pw${"@"}example.com/` })).toMatch(/login or a port/);
    expect(gateHostRefusal({ kind: "url", url: "https://[::1]/" })).toMatch(/IP address/);
    expect(gateHostRefusal({ kind: "window", window: { start: "08:00", end: "09:00" } })).toBeNull();
  });
});

describe("[M25.6] remove a job", () => {
  const made = async (w: World, p = ada.email) => {
    const chat = await open(w, p);
    w.fake.enqueue(load, create({ gate: { kind: "url", url: "https://example.com/news" } }), { text: "Set." });
    await w.say(p, "Watch the news page.", chat);
    const [id] = w.jobIds(p) as [string];
    return { chat, id };
  };

  it("jobs_remove asks on a card naming the job, and nothing changes until the person approves", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const { chat, id } = await made(w);
    w.fake.enqueue(remove(id), { text: "Asked." });
    await w.say(ada.email, "Remove the news watch.", chat);
    const [card] = w.cardsOf(ada.email);
    expect(card?.lines[0]).toBe("Remove job: Site watch");
    expect(w.jobOf(ada.email, id).instance.status()?.status).toBe("needs_enable");
    expect(w.jobIds(ada.email)).toEqual([id]);
  });

  it("on approval the job is archived, its alarm cleared, and it leaves jobs_list and the person's list", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const { chat, id } = await made(w);
    await w.jobOf(ada.email, id).instance.enable(ada.email);
    expect(w.jobOf(ada.email, id).alarmAt).not.toBeNull();
    w.fake.enqueue(remove(id), { text: "Asked." });
    await w.say(ada.email, "Remove the news watch.", chat);
    await approve(w, chat, ada.email);
    expect(w.jobOf(ada.email, id).instance.status()?.status).toBe("archived");
    expect(w.jobOf(ada.email, id).alarmAt).toBeNull();
    expect(w.jobIds(ada.email)).toEqual([]);
    w.fake.enqueue(list, { text: "Listed." });
    await w.say(ada.email, "What jobs do I have?", chat);
    expect(said(w, ada.email)).toContain("(no jobs)");
  });

  it("the same job asked for again after removal is made again, not found as existing", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const { chat, id } = await made(w);
    w.fake.enqueue(remove(id), { text: "Asked." });
    await w.say(ada.email, "Remove it.", chat);
    await approve(w, chat, ada.email);
    w.fake.enqueue(create({ gate: { kind: "url", url: "https://example.com/news" } }, "c9"), { text: "Set." });
    await w.say(ada.email, "Watch the news page again.", chat);
    expect(w.jobIds(ada.email)).toEqual([id]);
    expect(w.jobOf(ada.email, id).instance.status()?.status).toBe("needs_enable");
  });
});

describe("[M25.6] the cap counts only live jobs", () => {
  const fill = async (w: World) => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_JOBS; i++) {
      const id = `filler-${i}`;
      ids.push(id);
      await w.jobOf(ada.email, id).instance.define({ owner: ada.email, by: ada.email, def: { id, title: `Filler ${i}`, chat: "chat-x", owner: { kind: "chat", id: "chat-x" }, stop: { kind: "turned_off" }, timing: { schedule: { kind: "interval", every: 30 }, zone: "UTC" }, gate: { kind: "url", url: "https://example.com/" }, steps: [{ kind: "model" }, { kind: "notify" }], ceilingTokens: 20_000, instructions: `Filler ${i}.` } });
    }
    return ids;
  };
  const one = create({ title: "One more", instructions: "One more thing to watch.", gate: { kind: "url", url: "https://example.com/more" } }, "cm");

  it("at the cap jobs_create is refused JOBS_LIMIT and the refusal names jobs_remove", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await fill(w);
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, one, { text: "Full." });
    await w.say(ada.email, "Watch one more.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(MAX_JOBS);
    expect(said(w, ada.email)).toMatch(/JOBS_LIMIT.*jobs_remove/s);
  });

  it("removing one frees a place: the next jobs_create is registered", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const ids = await fill(w);
    await w.jobOf(ada.email, ids[0] as string).instance.remove(ada.email);
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, one, { text: "Set." });
    await w.say(ada.email, "Watch one more.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(MAX_JOBS);
    expect(w.jobIds(ada.email)).not.toContain(ids[0]);
    expect(said(w, ada.email)).not.toContain("JOBS_LIMIT");
  });

  it("a finished job frees a place too", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const ids = await fill(w);
    w.jobOf(ada.email, ids[1] as string).instance.store.updateJob({ status: "finished" }, w.clock.now);
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, one, { text: "Set." });
    await w.say(ada.email, "Watch one more.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(MAX_JOBS + 1);
  });
});
