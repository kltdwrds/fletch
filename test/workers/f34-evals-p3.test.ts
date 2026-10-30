// F34: the P3 tasks on a preview slot. The runner drives each P3 tier-2 task (Sam's prompts, a steer or a Stop while a
// child runs, the children waited out, a reload); the slot's test host serves the two probe pages from fixtures, the
// second slowly, leaves `example.invalid` unreachable, and keeps each chat model request's messages beside its prompt
// (`scripts/preview-slot/test-host-p3.mjs`); the readers and events over it (`scripts/evals/p3-slot.ts`) answer a P3
// grader as the tier-1 world does. Hermetic: the readers run over Sam's real chat in the P3 tier-1 world, played by the
// scripted fake model, its `subagents` and `mailbox` rows read from the chat's own SQLite by the op's code; the page
// is the tier-1 page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bindingPort } from "../../packages/agent/src/browse/binding.ts";
import { WORK_WORDS } from "../../packages/agent/src/chat/instructions.ts";
import { readPage } from "../../packages/agent/src/browse/read.ts";
import { type P3Page, type P3State, p3Slot } from "../../scripts/evals/p3-slot.ts";
import { type P5Page, p5Slot } from "../../scripts/evals/p5-slot.ts";
import { driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { childBrowse } from "../../scripts/preview-slot/test-host-child.mjs";
import { CHUNK, chunks, joinChunks, P3_PAGES, P3_PROBE, P3_PROBE_2, P3_TITLE, p3Rows, requestText, SLOW } from "../../scripts/preview-slot/test-host-p3.mjs";
import { recordingAi } from "../../scripts/preview-slot/test-host-p5.mjs";
import { testHostBinding } from "../../scripts/preview-slot/test-host-sites.mjs";
import failed, { NO_TITLE, UNREAD } from "../evals/p3-delegation/failed-child-real-model.task.ts";
import { type P3HarnessOptions, P3Tier1World, PAGE, pat, sam } from "../evals/p3-delegation/harness.ts";
import launch from "../evals/p3-delegation/launch-and-handoff-real-model.task.ts";
import launched from "../evals/p3-delegation/launch-says-launched.task.ts";
import reload from "../evals/p3-delegation/reload-and-phone.task.ts";
import { ACK, BRIEF, delegate, FAILED_BRIEF, FAILED_HANDOFF, load, reads, routed, runs } from "../evals/p3-delegation/runs.ts";
import steer from "../evals/p3-delegation/steer-real-model.task.ts";
import type { ChildRow, P3World } from "../evals/p3-delegation/world.ts";
import { DEAD, PROBE, PROBE_2, PROBE_TITLE } from "../evals/p3-delegation/world.ts";
import type { TaskView } from "../evals/p5-activity/world.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

type Sql = Parameters<typeof p3Rows>[0];
/** The chat's SQLite as the op reads it (`ctx.storage.sql`), over the tier-1 object's own storage. */
const sqlOf = (w: P3Tier1World, chat: "c1" | "c2" = "c1"): Sql => {
  const h = w.w.chats.harness(w.chatId(chat));
  return { exec: (q: string, ...b: unknown[]) => ({ toArray: () => h.rows(q, ...(b as never[])) }) };
};
const p5PageOver = (w: P3Tier1World): P5Page => ({ rows: () => w.rows(), drawer: (_c, id, phone) => w.drawer("c1", id, phone) });
const p3PageOver = (w: P3Tier1World): P3Page => ({ sections: (_c, id, phone) => w.sections("c1", id, phone), threadDom: (_c, phone) => w.threadDom("c1", phone) });

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(opts: () => P3HarnessOptions, worlds: P3Tier1World[] = []): Slot {
  return {
    name: "fletch-pv-test",
    async open() {
      const w = new P3Tier1World(opts());
      await w.open();
      worlds.push(w);
      const entries = () => w.engine("c1").history().entries as unknown as SlotEntry[];
      const routes = async (path: string, method: "GET" | "POST" = "GET") => w.w.http(sam.email, method, path);
      // The world has run to its end before a wait: each poll is a tick, so a row left out is named after a few.
      let clock = 0;
      const tick = async () => {
        clock += 1;
      };
      const p5 = p5Slot(() => w.chatId("c1"), entries, routes, async () => w.prompts(), p5PageOver(w), tick, () => clock);
      const p3 = p3Slot(() => w.chatId("c1"), entries, routes, async () => ({ ...p3Rows(sqlOf(w)), requests: w.requests() }), p3PageOver(w), tick, () => clock);
      const after = async () => {
        await p3.settle(clock + 3);
        await p5.settle(clock + 3);
      };
      const world = {
        chatId: w.chatId("c1"),
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        entries,
        reactions: () => [],
        async send(text: string) {
          await w.play({ kind: "prompt", by: sam.email, text });
          await after();
          return "";
        },
        // The tier-1 world plays the turn (its fake holds the child where the slot's slow page does); the slot's `reload`
        // keeps the entries and rows before the object is read again.
        async event(name: string, payload: Record<string, string>) {
          if (name === "reload") await p3.event("reload", payload, async () => "", 1);
          await w.play({ kind: "event", name, payload });
          // A prompt with `wait` leaves its sub-agents running, as the slot's does.
          if (name === "prompt" && payload.wait === "yes") await p3.refresh();
          else await after();
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p5.readers));
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p3.readers));
      // The probe page here is the tier-1 world's, under its title.
      Object.defineProperty(world, "probeTitle", { value: w.probeTitle });
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P3World>, opts: () => P3HarnessOptions, worlds?: P3Tier1World[]) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(opts, worlds), 1, () => new Date(0));

/** A scripted slot for the events: the Activity list, each task's drawer route, the Stop route and the `p3` op. */
function scripted(o: { tasks: () => Array<{ id: string; status: string }>; drawer?: (id: string) => unknown; stop?: { status: number; body: unknown }; state: () => P3State; deadlineAt?: number }) {
  let clock = 0;
  const posts: string[] = [];
  const read = async (path: string, method: "GET" | "POST" = "GET") => {
    if (method === "POST") {
      posts.push(path);
      return o.stop ?? { status: 200, body: { ok: true } };
    }
    if (path === "/app/activity") return { status: 200, body: { tasks: o.tasks().map((t) => ({ ...t, chatId: "c" })) } };
    return { status: 200, body: o.drawer?.(path.split("/").at(-1) as string) ?? { subagents: [] } };
  };
  const slot = p3Slot(
    () => "c",
    () => [],
    read,
    async () => o.state(),
    { sections: async () => [], threadDom: async () => ({ bubbles: [], lists: [], kinds: [] }) },
    async () => {
      clock += 1;
    },
    () => clock,
  );
  return { slot, posts, polls: () => clock };
}
const OUT = ["queued", "running", "waiting"];
/** A row; a settled one handed off unless `handedOffAt` says otherwise. */
const row = (id: string, status: string, code: string | null = null, handedOffAt: number | null = OUT.includes(status) ? null : 1): ChildRow => ({ id, grp: "g", turnId: "t", parent: "main", role: "worker", depth: 1, brief: "", status, code, tokens: 0, verdict: null, verdictReason: null, refusals: [], handedOffAt });

describe("[F34] P3 on a slot: the probe pages, the requests, the rows, the readers and the events", () => {
  it("every P3 version_hash in the contract is its file's hash, the tier-2 tasks' as first graded on the slot; an unfilled one is named", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P3-delegation.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P3-14's line put back to unset is caught by id.
    const t14 = /T-P3-14 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t14}`, "version_hash: unset"))).toEqual([`T-P3-14 unset ${t14}`]);
  });

  it("drives every P3 tier-2 task (prompts, midchild, children, reload), and refuses a P3 event to another cluster and a tier-1 event", () => {
    for (const t of [launch, steer, failed, reload]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    // Planted: the same turns under another cluster's id are refused at the first P3-only event, before any trial.
    expect(driveable({ ...steer, cluster: "P5" } as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 2 of T-P3-15 is the event midchild; the runner drives prompts and decide, tick, reload, open, prompt events only");
    // Planted: T-P3-01 plays the tier-1 harness's own `retry` (the host delivering a handoff again), which no slot can.
    expect(driveable(launched as unknown as DefinedTask<SlotWorld>, sam.email)).toMatch(/^EVALS_TASK_UNDRIVABLE: turn \d+ of T-P3-01 is the event retry; .*midchild, children events only$/);
  });

  it("the slot serves the tier-1 world's probe page with its title and three links, the second page after its delay, and example.invalid is unreachable, with no request made", async () => {
    // The tier-1 world's page under the slot's own title, which the slot's readers give the graders.
    expect([P3_PROBE, P3_PROBE_2, P3_PAGES[P3_PROBE]]).toEqual([PROBE, PROBE_2, PAGE.replace(PROBE_TITLE, P3_TITLE)]);
    expect(P3_TITLE).not.toBe(PROBE_TITLE);
    expect(p3Slot(() => "c", () => [], async () => ({ status: 200, body: {} }), async () => ({ children: [], mailbox: [], requests: [] }), { sections: async () => [], threadDom: async () => ({ bubbles: [], lists: [], kinds: [] }) }).readers.probeTitle).toBe(P3_TITLE);
    expect(P3_PAGES[P3_PROBE]?.match(/\]\(https:/g)).toHaveLength(3);
    const network = vi.spyOn(globalThis, "fetch");
    const waited: number[] = [];
    const reads: Array<{ host: string }> = [];
    const port = bindingPort(testHostBinding(async (e: { host: string }) => void reads.push(e), undefined, undefined, undefined, async (ms: number) => void waited.push(ms)));
    const memory = { get: async () => null, record: async () => {} };
    expect(await readPage({ port, memory, now: () => 0 }, PROBE)).toMatchObject({ ok: true, markdown: P3_PAGES[P3_PROBE] });
    expect(waited).toEqual([]);
    expect(await readPage({ port, memory, now: () => 0 }, PROBE_2)).toMatchObject({ ok: true, markdown: P3_PAGES[P3_PROBE_2] });
    expect(waited).toEqual([SLOW[P3_PROBE_2]]);
    expect(SLOW[P3_PROBE_2]).toBeGreaterThanOrEqual(30_000);
    expect(await readPage({ port, memory, now: () => 0 }, DEAD)).toMatchObject({ ok: false, code: "BROWSE_UNREACHABLE" });
    // Planted: with no slow page the second answers at once, so a steer could not reach a child mid-read.
    const quick: number[] = [];
    await readPage({ port: bindingPort(testHostBinding(async () => {}, undefined, undefined, {}, async (ms: number) => void quick.push(ms))), memory, now: () => 0 }, PROBE_2);
    expect(quick).toEqual([]);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it("a child on the slot reads both probe pages its brief names, and example.invalid is unreachable to it", async () => {
    const ns = childBrowse(sam.email, `Read ${PROBE} then ${PROBE_2}, and ${DEAD}.`, testHostBinding(async () => {}, undefined, undefined, {}), () => 0);
    const open = ns.tools[0] as { execute: (id: string, p: { url: string }) => Promise<{ content: Array<{ text: string }> }> };
    expect((await open.execute("c1", { url: PROBE })).content[0]?.text).toContain("3 links");
    expect((await open.execute("c2", { url: PROBE_2 })).content[0]?.text).toContain("The second p3 probe page");
    await expect(open.execute("c3", { url: DEAD })).rejects.toThrow(/BROWSE_UNREACHABLE/);
  });

  it("each chat request's messages are kept beside its prompt, the system prompt left out, a long one in several values joined back in order", async () => {
    const body = { messages: [{ role: "system", content: "You are fletch." }, { role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "hello" }] }] };
    expect(requestText(body)).toBe("hi\nhello");
    expect(requestText({ model: "muse-spark-1.3-contributor", messages: [{ role: "user", content: "routed" }] })).toBe("routed");
    expect(requestText({ text: ["embed"] })).toBeNull();
    const kept: Array<[string, unknown]> = [];
    await recordingAi({ run: async (..._: unknown[]) => "ok" }, async (p: string, b: unknown) => void kept.push([p, b])).run("m", body, {});
    expect(kept).toEqual([["You are fletch.", body]]);
    const long = "x".repeat(CHUNK * 2 + 5);
    const store = new Map<string, string>();
    for (const [n, text] of [["000002", "second"], ["000001", long]] as const) for (const [k, part] of chunks(text).entries()) store.set(`test-host:request:${n}:${String(k).padStart(3, "0")}`, part);
    expect(chunks(long)).toHaveLength(3);
    expect(joinChunks(store)).toEqual([long, "second"]);
    expect(chunks("")).toEqual([""]);
  });

  it("the op's rows are the chat's own: the sub-agent rows and the mailbox as the tier-1 world reads them", async () => {
    const worlds: P3Tier1World[] = [];
    expect(await run(launch, runs["T-P3-14"]!, worlds)).toMatchObject({ status: "pass" });
    const w = worlds[0] as P3Tier1World;
    const { children, mailbox } = p3Rows(sqlOf(w));
    expect(children).toEqual(w.children("c1"));
    expect(children).toHaveLength(1);
    expect(mailbox).toEqual(w.mailbox("c1"));
    expect(mailbox.some((m) => m.kind === "internal_handoff")).toBe(true);
    // Pat, the second member, has his own chat; its rows are not Sam's.
    expect(p3Rows({ exec: () => ({ toArray: () => [] }) })).toEqual({ children: [], mailbox: [] });
    expect(pat.email).not.toBe(sam.email);
  });

  it("the readers answer T-P3-14, 15, 16 and 17 as the tier-1 world does: each passes under the scripted fake", async () => {
    for (const [task, id] of [[launch, "T-P3-14"], [steer, "T-P3-15"], [failed, "T-P3-16"], [reload, "T-P3-17"]] as const) {
      expect(await run(task, runs[id]!)).toMatchObject({ status: "pass" });
    }
  });

  it("planted: a reply that withholds the failed page's 'no title' fails T-P3-16 on the slot's readers, and a read of another chat is not made", async () => {
    const worlds: P3Tier1World[] = [];
    const vague = () => ({ script: routed([load("subagents"), delegate([BRIEF, FAILED_BRIEF]), { text: ACK }, { text: "The first page is titled Example Domain. The other one had a problem." }], { children: [[DEAD, reads([DEAD], FAILED_HANDOFF)]], spare: 10 }) });
    expect(await run(failed, vague, worlds)).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the reply gives the first title and says the second page could not be read and has no title" });
    const w = worlds[0] as P3Tier1World;
    const slot = p3Slot(() => w.chatId("c1"), () => [], async () => ({ status: 200, body: {} }), async () => ({ ...p3Rows(sqlOf(w)), requests: [] }), p3PageOver(w));
    await slot.refresh();
    expect(slot.readers.children("c1")).toHaveLength(2);
    expect(() => slot.readers.children("c2")).toThrow(/^SLOT_P3_UNREAD/);
    expect(() => slot.readers.effects()).toThrow(/^SLOT_P3_UNREAD/);
    expect(() => slot.readers.held).toThrow(/^SLOT_P3_UNREAD/);
  });

  it("T-P3-16 hears WORK_WORDS' own failed-read words as the second page said plainly; a reply that only hints at it still fails", async () => {
    const example = /Example: "([^"]+)"/.exec(WORK_WORDS.split("\n")[1] as string)?.[1] as string;
    expect(example).toMatch(/^No page came back from/);
    expect([UNREAD.test(example), NO_TITLE.test(example)]).toEqual([true, true]);
    // What the slot's model wrote (F34's first run), and the F33 wording, each pass.
    for (const said of ["No page came back from example.invalid/p3-probe, so there is no title for that one.", "no page came back; the address did not resolve, so I have nothing from it.", "The second page could not be read, so it has no title."]) expect([UNREAD.test(said), NO_TITLE.test(said)]).toEqual([true, true]);
    // Planted: a hint, a page called unread with a title made up, and a failure with no word about the title.
    expect(UNREAD.test("The other one had a problem.")).toBe(false);
    expect(NO_TITLE.test("The second page could not be read; its title is Example Domain.")).toBe(false);
    expect(NO_TITLE.test("The second page could not be read.")).toBe(false);
    const reply = (text: string) => () => ({ script: routed([load("subagents"), delegate([BRIEF, FAILED_BRIEF]), { text: ACK }, { text }], { children: [[DEAD, reads([DEAD], FAILED_HANDOFF)]], spare: 10 }) });
    expect(await run(failed, reply(`The first page is titled Example Domain. ${example}`))).toMatchObject({ status: "pass" });
    expect(await run(failed, reply("The first page is titled Example Domain. The second could not be read."))).toMatchObject({ status: "fail", code: "GRADER_FAILED" });
  });

  it("planted: a closed child's report in a chat request fires T-P3-15's closed_child_hands_off over the op's requests", async () => {
    const mine = steer.graders.find((g) => g.name === "closed_child_hands_off") as { check: (w: P3World) => boolean };
    const state = (requests: string[]): P3State => ({ children: [row("s1", "failed", "SUBAGENT_CLOSED"), row("s2", "done")], mailbox: [], requests });
    for (const [requests, fires] of [[["plain"], false], [['<data source="subagent:s1">late</data>'], true]] as const) {
      const { slot } = scripted({ tasks: () => [], state: () => state([...requests]) });
      await slot.refresh();
      expect(mine.check(slot.readers as unknown as P3World)).toBe(fires);
    }
  });

  it("midchild: the steer is sent once a running child shows a step, then everything is waited out", async () => {
    let sent = 0;
    let drawerReads = 0;
    const { slot, polls } = scripted({
      tasks: () => [{ id: "t1", status: sent ? "done" : "running" }],
      drawer: () => ({ subagents: [{ n: "01", rows: [{ id: "s1", status: "running", code: null, steps: ++drawerReads > 2 ? [{ n: 1 }] : [] }] }] }),
      state: () => ({ children: [row("s1", sent ? "failed" : "running")], mailbox: [], requests: [] }),
    });
    const send = vi.fn(async () => void sent++);
    expect(await slot.event("midchild", { text: "skip the second page and finish" }, send, 100)).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith("skip the second page and finish");
    expect(drawerReads).toBe(3);
    expect(polls()).toBe(2);
    // A child that settles before it is seen mid-run is "already finished": the steer is still sent.
    const early = scripted({ tasks: () => [{ id: "t1", status: "done" }], state: () => ({ children: [row("s1", "done")], mailbox: [], requests: [] }) });
    const send2 = vi.fn(async () => {});
    await early.slot.event("midchild", { text: "x" }, send2, 100);
    expect(send2).toHaveBeenCalledOnce();
  });

  it("midchild with stop presses the oldest running task's Stop through the drawer's route; a refused Stop and a child never seen are named", async () => {
    let stopped = false;
    const { slot, posts } = scripted({
      tasks: () => (stopped ? [] : [{ id: "t2", status: "running" }, { id: "t1", status: "running" }]),
      drawer: () => ({ subagents: [{ n: "01", rows: [{ id: "s1", status: "running", code: null, steps: [{ n: 1 }] }] }] }),
      state: () => {
        if (posts.length) stopped = true;
        return { children: [row("s1", stopped ? "failed" : "running", stopped ? "SUBAGENT_STOPPED" : null)], mailbox: [], requests: [] };
      },
    });
    await slot.event("midchild", { stop: "yes" }, async () => {}, 100);
    expect(posts).toEqual(["/app/activity/c/t1/stop"]);
    // Planted: the Stop refused by the route is the trial's failure by name, never a silent pass.
    const refused = scripted({ tasks: () => [{ id: "t1", status: "running" }], drawer: () => ({ subagents: [{ n: "01", rows: [{ id: "s1", status: "running", code: null, steps: [{ n: 1 }] }] }] }), stop: { status: 409, body: { ok: false, code: "TASK_NOT_RUNNING" } }, state: () => ({ children: [row("s1", "running")], mailbox: [], requests: [] }) });
    await expect(refused.slot.event("midchild", { stop: "yes" }, async () => {}, 100)).rejects.toThrow("P3_STOP_REFUSED: the drawer's Stop answered 409 TASK_NOT_RUNNING");
    // Planted: a child that never shows a step and never settles is named at the deadline.
    const never = scripted({ tasks: () => [{ id: "t1", status: "running" }], state: () => ({ children: [row("s1", "running")], mailbox: [], requests: [] }) });
    await expect(never.slot.event("midchild", { text: "x" }, async () => {}, 3)).rejects.toThrow(/^P3_NO_CHILD_MIDRUN/);
  });

  it("children waits until no task runs and no row is out; a row left out is named at the deadline; reload keeps the entries and rows as they stood", async () => {
    let n = 0;
    const { slot } = scripted({ tasks: () => [{ id: "t1", status: "done" }], state: () => ({ children: [row("s1", ++n > 3 ? "done" : "running")], mailbox: [], requests: [] }) });
    await slot.event("children", {}, async () => {}, 100);
    expect(n).toBe(4);
    const stuck = scripted({ tasks: () => [{ id: "t1", status: "done" }], state: () => ({ children: [row("s1", "queued")], mailbox: [], requests: [] }) });
    await expect(stuck.slot.settle(2)).rejects.toThrow("P3_UNSETTLED: the newest task is done and 1 sub-agent(s) are out or not handed off");
    // Planted: a child done whose handoff has not entered the chat is waited for (F34's first T-P3-15 run read too early).
    let reads = 0;
    const pending = scripted({ tasks: () => [{ id: "t1", status: "done" }], state: () => ({ children: [row("s1", "done", null, ++reads > 2 ? 5 : null)], mailbox: [], requests: [] }) });
    await pending.slot.settle(100);
    expect(reads).toBe(3);
    // Planted: the newest task still running is waited for too.
    const busy = scripted({ tasks: () => [{ id: "t2", status: "running" }], state: () => ({ children: [], mailbox: [], requests: [] }) });
    await expect(busy.slot.settle(2)).rejects.toThrow("P3_UNSETTLED: the newest task is running and 0 sub-agent(s) are out or not handed off");
    let entries: SlotEntry[] = [{ kind: "you", mid: "m1" }, { kind: "stopped", turn: "t9" }];
    const rows = [row("s1", "failed", "SUBAGENT_STOPPED")];
    const kept = p3Slot(() => "c", () => entries, async () => ({ status: 200, body: { tasks: [] } }), async () => ({ children: rows, mailbox: [], requests: [] }), { sections: async () => [], threadDom: async () => ({ bubbles: [], lists: [], kinds: [] }) });
    await kept.refresh();
    expect(kept.readers.reloaded).toBeNull();
    expect(await kept.event("reload", {}, async () => {}, 1)).toBe(true);
    entries = [];
    expect(kept.readers.reloaded).toEqual({ entries: ["you:m1", "stopped:t9"], statuses: ["s1:failed:SUBAGENT_STOPPED"] });
    expect(kept.readers.entryIds()).toEqual([]);
    expect(await kept.event("decide", {}, async () => {}, 1)).toBe(false);
  });

  it("the trial's own chat only, its newest task: another chat's task and an older task left running by a closed delegation are not waited for", async () => {
    const tasks: Array<TaskView & { chatId: string }> = [{ id: "old", chatId: "other", status: "running" } as never, { id: "t2", chatId: "c", status: "done" } as never, { id: "t1", chatId: "c", status: "running" } as never];
    const slot = p3Slot(() => "c", () => [], async () => ({ status: 200, body: { tasks } }), async () => ({ children: [], mailbox: [], requests: [] }), { sections: async () => [], threadDom: async () => ({ bubbles: [], lists: [], kinds: [] }) }, async () => {}, () => 0);
    await expect(slot.settle(1)).resolves.toBeUndefined();
  });
});
