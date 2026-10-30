// F32: the P5 tasks on a preview slot. The runner drives each P5 tier-2 task (Sam's prompts and the `open` event); the
// slot's test host serves the probe page from a fixture and leaves `example.invalid` unreachable, keeps each chat model
// request's system prompt, and lets a sub-agent read the probe page (`scripts/preview-slot/test-host-p5.mjs`,
// `test-host-child.mjs`); the readers over it (`scripts/evals/p5-slot.ts`) answer a P5 grader as the tier-1 world does.
// Hermetic: the readers run over Sam's real chats in the P5 tier-1 world, played by the scripted fake model, and the
// page is the tier-1 page.
import { describe, expect, it, vi } from "vitest";
import { type P5Page, p5Slot } from "../../scripts/evals/p5-slot.ts";
import { driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { childBrowse } from "../../scripts/preview-slot/test-host-child.mjs";
import { P5_PROBE, PAGES, recordingAi, systemOf } from "../../scripts/preview-slot/test-host-p5.mjs";
import { testHostBinding } from "../../scripts/preview-slot/test-host-sites.mjs";
import { VERIFIER_INSTRUCTIONS } from "../../packages/agent/src/subagents/verifier.ts";
import { bindingPort } from "../../packages/agent/src/browse/binding.ts";
import { readPage } from "../../packages/agent/src/browse/read.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { PAGE, type P5HarnessOptions, P5Tier1World, pat, sam } from "../evals/p5-activity/harness.ts";
import failedRead, { answersFirst, NOTHING_BACK } from "../evals/p5-activity/failed-read-real-model.task.ts";
import { WORK_WORDS } from "../../packages/agent/src/chat/instructions.ts";
import oneTask, { count } from "../evals/p5-activity/one-request-one-task-real-model.task.ts";
import reload from "../evals/p5-activity/reload-and-phone.task.ts";
import { ASK, load, read, REPLY, runs, TWO, write } from "../evals/p5-activity/runs.ts";
import ack from "../evals/p5-activity/subagent-ack-real-model.task.ts";
import stopTask from "../evals/p5-activity/subagent-section.task.ts";
import type { P5World, TaskView } from "../evals/p5-activity/world.ts";
import { DEAD, PROBE } from "../evals/p5-activity/world.ts";

/** Sam's page as the tier-1 world draws it, by chat id. */
const pageOver = (w: P5Tier1World): P5Page => ({
  rows: () => w.rows(),
  drawer: (chatId, id, phone) => w.drawer(chatId === w.chatId("c2") ? "c2" : "c1", id, phone),
});

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(opts: () => P5HarnessOptions, worlds: P5Tier1World[] = []): Slot {
  return {
    name: "fletch-pv-test",
    async open() {
      const w = new P5Tier1World(opts());
      await w.open();
      worlds.push(w);
      const entries = () => w.engine("c1").history().entries as unknown as SlotEntry[];
      const p5 = p5Slot(() => w.chatId("c1"), entries, async (path) => w.w.http(sam.email, "GET", path), async () => w.prompts(), pageOver(w), async () => {}, () => 0);
      const world = {
        chatId: w.chatId("c1"),
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        entries,
        reactions: () => [],
        async send(text: string) {
          await w.play({ kind: "prompt", by: sam.email, text });
          await p5.settle(1);
          return "";
        },
        async event(name: string) {
          if (name !== "open") throw new Error(`unexpected event ${name}`);
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p5.readers));
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P5World>, opts: () => P5HarnessOptions, worlds?: P5Tier1World[]) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(opts, worlds), 1, () => new Date(0));

describe("[F32] P5 on a slot: the probe page, the prompts, the child's reads and the readers", () => {
  it("drives every P5 tier-2 task (Sam's prompts, open), and still refuses an event the slot cannot play", () => {
    for (const t of [failedRead, oneTask, reload, ack]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    // Planted: T-P5-08 plays the tier-1 harness's own events (a held prompt, the children), which no slot can: refused
    // by name before any trial.
    expect(driveable(stopTask as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 1 of T-P5-08 is the event prompt; the runner drives prompts and decide, tick, reload, open events only");
  });

  it("the slot serves the tier-1 world's probe page with its one link, and example.invalid is unreachable, with no request made", async () => {
    expect(PAGES[P5_PROBE]).toBe(PAGE);
    expect(P5_PROBE).toBe(PROBE);
    const network = vi.spyOn(globalThis, "fetch");
    const reads: Array<{ host: string }> = [];
    const port = bindingPort(testHostBinding(async (e: { host: string }) => void reads.push(e)));
    const memory = { get: async () => null, record: async () => {} };
    const probe = await readPage({ port, memory, now: () => 0 }, PROBE);
    expect(probe).toMatchObject({ ok: true, markdown: PAGE });
    expect(await readPage({ port, memory, now: () => 0 }, DEAD)).toMatchObject({ ok: false, stopped: false, code: "BROWSE_UNREACHABLE" });
    // Planted: the page is served by its whole address, not its host: another example.com page is a 404 here.
    expect((await port.read("https://example.com/elsewhere", "kitesurf")).ok).toBe(false);
    // Planted: without the fixture the probe is unreachable too, so a slot that lost it fails T-P5-15 rather than reading the web.
    expect(await readPage({ port: bindingPort(testHostBinding(async () => {}, {}, {})), memory, now: () => 0 }, PROBE)).toMatchObject({ ok: false, code: "BROWSE_UNREACHABLE" });
    expect(reads.map((r) => r.host)).toEqual(["example.com", "example.invalid", "example.invalid", "example.com"]);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it("each chat model request's system prompt is kept before it is sent, unchanged; the verifier's and an embedding are not", async () => {
    const sent: unknown[] = [];
    const ai = {
      run: async (_m: string, body: unknown, _o?: unknown) => {
        sent.push(body);
        return "answer";
      },
      gateway: (_id: string) => ({
        run: async (req: unknown, _o?: unknown) => {
          sent.push(req);
          return "gateway answer";
        },
      }),
      models: () => "models",
    };
    const kept: string[] = [];
    const wrapped = recordingAi(ai, async (p: string) => void kept.push(p), (p: string) => p.startsWith(VERIFIER_INSTRUCTIONS));
    const chat = { messages: [{ role: "system", content: "You are fletch." }, { role: "user", content: "hi" }] };
    expect(await wrapped.run("m", chat, {})).toBe("answer");
    expect(await wrapped.gateway("g").run({ provider: "openrouter", query: { messages: [{ role: "system", content: [{ type: "text", text: "Routed." }] }] } }, {})).toBe("gateway answer");
    await wrapped.run("m", { messages: [{ role: "system", content: `${VERIFIER_INSTRUCTIONS}\nmore` }] }, {});
    await wrapped.run("embed", { text: ["a"] }, {});
    expect(kept).toEqual(["You are fletch.", "Routed."]);
    expect(sent[0]).toBe(chat);
    expect(sent).toHaveLength(4);
    expect(wrapped.models()).toBe("models");
    expect(systemOf({ messages: [{ role: "user", content: "x" }] })).toBeNull();
  });

  it("a child on the slot reads the probe page its brief names, and only an address its brief carries", async () => {
    const ns = childBrowse(sam.email, `Count the sentences on ${PROBE}.`, testHostBinding(async () => {}), () => 0);
    expect(ns.tools.map((t: { name: string }) => t.name)).toEqual(["browse_open"]);
    const open = ns.tools[0] as { execute: (id: string, p: { url: string }) => Promise<{ content: Array<{ text: string }> }> };
    expect((await open.execute("c1", { url: PROBE })).content[0]?.text).toContain("(via kitesurf, 1 links)");
    // Planted: an address the brief does not carry is refused by code, as the chat's own read refuses it.
    await expect(open.execute("c2", { url: "https://example.com/p5-other" })).rejects.toThrow(/BROWSE_URL_NOT_VERBATIM/);
  });

  it("the readers answer T-P5-12, 13, 14 and 15 as the tier-1 world does: each passes under the scripted fake", async () => {
    for (const [task, id] of [[reload, "T-P5-12"], [failedRead, "T-P5-13"], [ack, "T-P5-14"], [oneTask, "T-P5-15"]] as const) {
      expect(await run(task, runs[id]!)).toMatchObject({ status: "pass" });
    }
  });

  it("planted: a reply that says two links fails T-P5-15 on the slot's readers, and a read as Pat is not made", async () => {
    const worlds: P5Tier1World[] = [];
    expect(await run(oneTask, () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: TWO }] }), worlds)).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the reply's link count equals the file's and the page's" });
    const w = worlds[0] as P5Tier1World;
    const slot = p5Slot(() => w.chatId("c1"), () => [], async (path) => w.w.http(sam.email, "GET", path), async () => [], pageOver(w));
    const id = ((await slot.readers.activity()).tasks[0] as TaskView).id;
    await expect(slot.readers.task("c1", id, "pat")).rejects.toThrow(/^SLOT_P5_UNREAD/);
    // Pat, the second member, reading Sam's task through the route is refused there (the tier-1 world seats both).
    expect((await w.w.http(pat.email, "GET", `/app/activity/${w.chatId("c1")}/${id}`)).status).not.toBe(200);
    expect(() => slot.readers.results()).toThrow(/^SLOT_P5_UNREAD/);
    expect(REPLY).not.toBe(TWO);
  });

  it("T-P5-13 hears the instruction's own words for a read that failed, and a reply that only answers the first page still fails", async () => {
    // The instruction line's example passes its own grader.
    expect(NOTHING_BACK.test(/Example: "([^"]+)"/.exec(WORK_WORDS.split("\n")[1] as string)?.[1] as string)).toBe(true);
    expect(["Nothing came back from the second address.", "The second gave nothing back.", "The second returned nothing.", "The second page could not be read.", "Here is the second page."].map((t) => NOTHING_BACK.test(t))).toEqual([true, true, true, true, false]);
    // The first page is answered by its title or by its own words quoted; a reply about something else answers nothing.
    expect(["It is titled The p5 probe page.", 'It says: "The probe has one line of text."', "It is a page about probes."].map(answersFirst)).toEqual([true, true, false]);
    const reply = (text: string) => () => ({ script: [load("browse"), read(PROBE, "r1"), read(DEAD, "r2"), { text }] });
    expect(await run(failedRead, reply("The first page is The p5 probe page. The second returned nothing, so I have nothing from it."))).toMatchObject({ status: "pass" });
    // Planted: the second page passed over in silence, and the second page's failure said with its raw code.
    expect(await run(failedRead, reply("The first page is The p5 probe page, with one link."))).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the reply answers the first page and says plainly no page came back from the second" });
    expect(await run(failedRead, reply("The first page is The p5 probe page. The second could not be read (BROWSE_UNREACHABLE)."))).toMatchObject({ status: "fail", code: "GRADER_FAILED" });
  });

  it("the thread is what Sam sees: the model's reasoning, never drawn, is no entry of it, so naming a tool there is no narration", async () => {
    const at = 0;
    const entries = (thinking: string, agent: string) => () => [{ kind: "you", text: ASK, at }, { kind: "thinking", text: thinking, at }, { kind: "agent", text: agent, at }] as unknown as SlotEntry[];
    const quiet = p5Slot(() => "c", entries("Simple: browse_open, then file_write.", REPLY), async () => ({ status: 200, body: {} }), async () => [], { rows: async () => [], drawer: async () => null });
    expect(quiet.readers.thread().map((e) => e.kind)).toEqual(["you", "agent"]);
    const narrated = oneTask.graders.find((g) => g.name === "narrated_calls") as { check: (w: P5World) => boolean };
    expect(narrated.check(quiet.readers as unknown as P5World)).toBe(false);
    // Planted: the same tool named in the reply the thread draws is narration.
    const loud = p5Slot(() => "c", entries("", "I ran browse_open, then file_write."), async () => ({ status: 200, body: {} }), async () => [], { rows: async () => [], drawer: async () => null });
    expect(narrated.check(loud.readers as unknown as P5World)).toBe(true);
  });

  it("T-P5-15 reads a file's count as the slot's model writes it (\"Link count: 1\"), and a file that says another count still fails", async () => {
    expect([count("1 link"), count("It has two links."), count("# p5-probe\n\nTitle: The p5 probe page\nLink count: 1\n"), count("Links: 3"), count("The p5 probe page")]).toEqual(["1", "2", "1", "3", null]);
    expect(await run(oneTask, () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write("w1", "Title: The p5 probe page\nLink count: 1\n"), { text: REPLY }] }))).toMatchObject({ status: "pass" });
    // Planted: the file's field says two over a page with one link.
    expect(await run(oneTask, () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write("w1", "Title: The p5 probe page\nLink count: 2\n"), { text: REPLY }] }))).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the reply's link count equals the file's and the page's" });
  });

  it("the trial's own chat only: an earlier chat's task is left out of the list, and a task still running is waited for until the deadline", async () => {
    const w = new P5Tier1World(runs["T-P5-15"]!());
    await w.open();
    await w.play({ kind: "event", name: "prompt", payload: { text: ASK, chat: "c2" } });
    await w.play({ kind: "prompt", by: sam.email, text: ASK });
    const routes = async (path: string) => w.w.http(sam.email, "GET", path);
    const slot = p5Slot(() => w.chatId("c1"), () => [], routes, async () => ["p"], pageOver(w));
    expect((await slot.readers.activity()).tasks.map((t) => t.chat)).toEqual(["c1"]);
    // A task that stays running: read again each poll, then refused by name at the deadline.
    let clock = 0;
    let polls = 0;
    const running = async (path: string) => {
      const r = await routes(path);
      if (path !== "/app/activity") return r;
      polls++;
      const b = r.body as { tasks: Array<{ chatId: string; status: string }> };
      return { ...r, body: { ...b, tasks: b.tasks.map((t) => ({ ...t, status: "running" })) } };
    };
    const pause = async (ms: number) => {
      clock += ms;
    };
    const waiting = p5Slot(() => w.chatId("c1"), () => [], running, async () => [], pageOver(w), pause, () => clock);
    await expect(waiting.settle(5_000)).rejects.toThrow(/^P5_TASK_UNSETTLED: the task is still running/);
    expect(polls).toBe(4);
    await slot.settle(0);
    expect(slot.readers.prompts()).toEqual(["p"]);
  });
});
