// F30: the P7 tasks on a preview slot. The runner plays a job's tick and a reload as well as prompts and decisions; the
// slot's test host serves the probe page from a fixture, keeps each job's clock (its alarms moved back by the same skew,
// so a tick fires the job's next alarm now) and answers the `p7` op (`scripts/preview-slot/test-host-p7.mjs`); the
// readers over it (`scripts/evals/p7-slot.ts`) answer a P7 grader as the tier-1 world does. Hermetic: the op's calls run
// on Sam's real Job engines in the P7 tier-1 world, played by the scripted fake model, and the page is the tier-1 page.
import { describe, expect, it, vi } from "vitest";
import { type P7Page, p7Seeds, p7Slot, ZONE } from "../../scripts/evals/p7-slot.ts";
import { driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { clockedStorage, type P7Host, p7Op, PROBE, PROBE_PAGE, probeGet, skewToNext } from "../../scripts/preview-slot/test-host-p7.mjs";
import { report } from "../support/fake-model.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { P7Tier1World, sam } from "../evals/p7-scheduling/harness.ts";
import oneShot from "../evals/p7-scheduling/one-shot-set-real-model.task.ts";
import result from "../evals/p7-scheduling/result-in-chat-real-model.task.ts";
import { oneShot as oneShotScript, quiet, read, silent } from "../evals/p7-scheduling/runs.ts";
import silence from "../evals/p7-scheduling/silence-real-model.task.ts";
import stop from "../evals/p7-scheduling/stop-is-said.task.ts";
import surfaces from "../evals/p7-scheduling/upcoming-and-dialog.task.ts";
import type { P7World } from "../evals/p7-scheduling/world.ts";

/** The test host's `p7` stubs over the tier-1 world: Sam's Job engines, her job index, c1's notices, the fake's calls. */
function hostOver(w: P7Tier1World): P7Host {
  const jobs = w.w.host(sam.email).jobs;
  return {
    person: {
      jobIds: async () => w.w.jobIds(sam.email),
      testHostP7Reset: async (zone) => {
        for (const id of w.w.jobIds(sam.email)) jobs.forget(id);
        jobs.homeZone(zone);
      },
    },
    job: (id) => ({
      define: async (a) => w.engine(id).define(a as never) as never,
      disable: async (by) => w.engine(id).disable(by) as never,
      remove: async (by) => w.engine(id).remove(by) as never,
      inspect: async (by) => w.engine(id).inspect(by) as never,
      // The tier-1 world's tick stands for the object's skew: the job's next alarm, fired now.
      testHostTick: async () => (await w.tick(w.engine(id).status()?.def.title), { ok: true }),
      testHostClock: async () => ({ alarmAt: w.w.jobOf(sam.email, id).alarmAt, now: w.now(), egress: [] }),
    }),
    chat: async () => ({ testHostNotices: async () => w.chat().notices() }),
    ledger: { testHostCalls: async () => w.calls().map((c) => ({ person: sam.email, run_id: "", route: c.side })) },
  };
}

/** Sam's page as the tier-1 world draws it, by job id. */
const pageOver = (w: P7Tier1World): P7Page => ({
  dialog: async (id) => w.dialog(w.engine(id).status()?.def.title as string),
  groups: () => w.groups(),
  phoneSheet: () => w.phoneSheet(),
});

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(script: () => import("../support/fake-model.ts").FakeStep[], worlds: P7Tier1World[] = []): Slot {
  return {
    name: "fletch-pv-test",
    async open(task) {
      const w = new P7Tier1World({ script: script() });
      await w.open();
      worlds.push(w);
      const entries = () => w.chat().history().entries as unknown as SlotEntry[];
      const p7 = p7Slot((call) => p7Op({ ...call, chat: w.c1 }, sam.email, hostOver(w)), () => w.c1, entries, async (path) => w.w.http(sam.email, "GET", path), pageOver(w));
      await p7.begin(task?.id ?? "", w.now());
      const world = {
        chatId: w.c1,
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        entries,
        reactions: () => [],
        async send(text: string) {
          p7.started(w.now());
          await w.say(text);
          await p7.refresh("prompt");
          return "";
        },
        async event(name: string, payload: Record<string, string>) {
          if (name === "tick") await p7.tick(payload.job);
          else if (name === "decide") await w.decide();
          await p7.refresh(`event:${name}`);
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p7.readers));
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P7World>, script: () => import("../support/fake-model.ts").FakeStep[], worlds?: P7Tier1World[]) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(script, worlds), 1, () => new Date(0));

describe("[F30] P7 on a slot: the runner's ticks, the test host's clock and probe page, and the readers", () => {
  it("drives every P7 tier-2 task (prompts, decide, tick, reload), and still refuses an event the slot cannot play", () => {
    for (const t of [oneShot, result, silence, surfaces]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    // Planted: T-P7-05 holds a run at its model step, which no slot can do: refused by name before any trial.
    expect(driveable(stop as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 1 of T-P7-05 is the event hold; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("the probe page answers from the fixture; any other url is a 404 here, recorded, and never reaches the network", async () => {
    const seen: Array<{ url: string; credentialed: boolean }> = [];
    const network = vi.spyOn(globalThis, "fetch");
    const get = probeGet((e) => seen.push(e));
    expect(await get(PROBE, [])).toMatchObject({ ok: true, status: 200, body: PROBE_PAGE });
    // Planted: a run that tries to send is answered here, with no request made.
    expect((await get("https://httpbin.org/post", [["authorization", "Bearer x"]])).status).toBe(404);
    expect(seen).toEqual([{ url: PROBE, credentialed: false }, { url: "https://httpbin.org/post", credentialed: true }]);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it("the job's clock: an alarm armed in its time fires at the real one, and a tick's skew reaches the next alarm and never goes back", async () => {
    const set: number[] = [];
    const storage = { sql: {}, transactionSync: (f: () => unknown) => f(), setAlarm: async (t: number) => void set.push(t), deleteAlarm: async () => {} };
    let skew = 0;
    const clocked = clockedStorage(storage, () => skew);
    skew = 600_000;
    await clocked.setAlarm(1_000_600_000);
    expect(set).toEqual([1_000_000_000]);
    expect(skewToNext(600_000, 1_000_300_000, 1_000_000_000)).toBe(900_001);
    expect(skewToNext(600_000, 999_000_000, 1_000_000_000)).toBe(600_001);
    expect(skewToNext(600_000, null, 1_000_000_000)).toBeNull();
  });

  it("the op: reset removes Sam's jobs and saves her zone, define makes one as its owner (off when asked), and bad calls are refused by code", async () => {
    const w = new P7Tier1World({ script: [] });
    await w.open();
    const h = hostOver(w);
    const def = p7Seeds("T-P7-14", w.c1, w.now())[3] as Record<string, unknown>;
    expect(await p7Op(def, sam.email, h)).toMatchObject({ ok: true });
    const id = (def.def as { id: string }).id;
    expect(w.engine(id).status()?.status).toBe("disabled");
    expect(await p7Op({ do: "reset", zone: ZONE }, sam.email, h)).toEqual({ ok: true, removed: [id] });
    expect(w.engine(id).status()?.status).toBe("archived");
    expect(w.w.jobIds(sam.email)).toEqual([]);
    // Planted: an id the Job objects would never name, a tick of no job, and an op that does not exist.
    expect(await p7Op({ do: "define", def: { id: "../sam" } }, sam.email, h)).toMatchObject({ ok: false, code: "P7_JOB_ID_INVALID" });
    expect(await p7Op({ do: "tick", id: "Not An Id" }, sam.email, h)).toMatchObject({ ok: false, code: "P7_JOB_ID_INVALID" });
    expect(await p7Op({ do: "drop" }, sam.email, h)).toMatchObject({ ok: false, code: "P7_OP_UNKNOWN" });
    // A trial's seeded ids carry its tag, so a removed job's runs never return in the next trial.
    expect(p7Seeds("T-P7-11", w.c1, 1)[0]).not.toEqual(p7Seeds("T-P7-11", w.c1, 2)[0]);
  });

  it("the readers answer T-P7-09, 10 and 11 as the tier-1 world does: each passes under the scripted fake", async () => {
    expect(await run(oneShot, () => [...oneShotScript])).toMatchObject({ status: "pass" });
    expect(await run(result, () => [report("It is five past eleven."), quiet])).toMatchObject({ status: "pass" });
    const worlds: P7Tier1World[] = [];
    expect(await run(silence, () => [read("r1"), silent(["r1"]), read("r2"), silent(["r2"], "s2")], worlds)).toMatchObject({ status: "pass" });
    expect(worlds[0]?.runs().map((r) => r.signal)).toEqual(["nothing_to_report", "nothing_to_report"]);
  });

  it("planted: a run that speaks fails T-P7-11 on the slot's readers, and T-P7-14 fails only on the run history drawn open", async () => {
    expect(await run(silence, () => [read("r1"), report("The page is unchanged."), quiet, read("r2"), silent(["r2"], "s2")])).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "two runs nothing_to_report and the watermark committed" });
    expect(await run(surfaces, () => [])).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the dialog shows the badge in words, the time, the collapsed run history and the fixed actions" });
  });
});
