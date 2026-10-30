// The tier-1 runs of the P7 tasks (F29): each task's script and seed for `p7Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with the fault planted. One fake script serves the chat's turns, each
// job's model step and each turn a job's notice wakes (F24's handoff, which here has nothing to add), in the order
// they run.
import { type FakeStep, report } from "../../support/fake-model.ts";
import { answer, callFrom, idIn, load, type P7HarnessOptions, type P7Tier1World, replyFrom } from "./harness.ts";
import { INSTRUCTIONS, TITLE } from "./one-shot-set.task.ts";
import { PROBE } from "./world.ts";

/** A woken turn with nothing to add to a job's notice (F24): it draws nothing. */
export const quiet: FakeStep = { text: "" };
const resolved = (r: string[]) => /Resolved time: ([^\n]+?)\. The person/.exec(r.join("\n"))?.[1] ?? "";

/** T-P7-01's turn: the create, the job's card, and after Sam's decision the reply naming the time. */
export const oneShot: FakeStep[] = [
  load,
  { toolCall: { id: "call_create", name: "jobs_create", arguments: { title: TITLE, instructions: INSTRUCTIONS, schedule: { kind: "runonce", in_minutes: 5 } } } },
  callFrom((r) => ({ id: "call_enable", name: "jobs_enable", arguments: { id: idIn(r) } })),
  replyFrom((r) => `Set: I will tell you the time in words ${resolved(r)}.`),
];

/** A job step's `page_read` of the probe page. */
export const read = (id = "r1"): FakeStep => ({ toolCall: { id, name: "page_read", arguments: { url: PROBE } } });
/** A job step's `nothing_to_report`, its checklist naming `evidence` and the page read as its one dependency. */
export const silent = (evidence: string[], id = "s1", over: Record<string, unknown> = {}): FakeStep => ({
  toolCall: { id, name: "nothing_to_report", arguments: { work: "read the p7 probe page", material_result: false, evidence, dependencies: evidence.includes("gate") ? [] : [{ tool: "page_read", available: true, workaround: false }], watermark: "p7 probe seen", ...over } },
});
/** A job step that ends with words and no terminal call (JOB_TERMINAL_MISSING once the reminder is spent). */
export const noTerminal: FakeStep = { text: "I could not." };

/** The jobs Sam defines herself in a seed (on at once, chat c1). */
export const WATCH = { id: "p7-probe-watch", title: "p7 probe: watch the page", instructions: "Read the p7 probe page and tell me what changed; if nothing changed, say nothing." };
export const HOUR = { id: "p7-probe-hour", title: "p7 probe: an hour on", instructions: "Tell me the p7 probe is done." };
export const HOUR_FAILS = { id: "p7-probe-hour-b", title: "p7 probe: an hour on, failing", instructions: "Tell me the p7 probe failed on purpose." };
export const HALF = { id: "p7-probe-half", title: "p7 probe: every half hour", instructions: "Read the p7 probe page and report its first paragraph." };
export const MORNING = { id: "p7-probe-morning", title: "p7 probe: the morning check", instructions: "Read the first paragraph of the p7 probe page." };
export const MOVED = "Read the second paragraph of the p7 probe page.";
export const DONE_WORD = { id: "p7-probe-done", title: "p7 probe: the word done", instructions: "Read the p7 probe page, then reply with the one word done." };
export const COUNT = { title: "p7 probe: the count past 40", instructions: "Tell me the count on the p7 probe page has passed 40." };

const every = (n: number) => ({ schedule: { kind: "interval" as const, every: n }, zone: "Europe/London" });
const at = (local: string) => ({ schedule: { kind: "runonce" as const, at: local }, zone: "Europe/London" });

/** T-P7-01 played as a seed: the one-shot made and turned on. */
const oneShotSeed = async (w: P7Tier1World) => {
  await w.say("in five minutes, tell me the time in words (p7 probe)");
  await w.decide();
};

/** T-P7-14's four jobs: a one-shot, a daily and a weekly job, and one turned off. */
const surfacesSeed = async (w: P7Tier1World) => {
  const daily = { schedule: { kind: "daily" as const, at: "09:00" }, zone: "Europe/London" };
  await w.defineJob({ id: "p7-probe-noon", title: "p7 probe: reminder at noon", instructions: "Remind me of the p7 probe.", timing: at("2026-10-13T12:00"), stop: { kind: "after_runs", runs: 1 } });
  await w.defineJob({ id: "p7-probe-nine", title: "p7 probe: daily at nine", instructions: "Read the p7 probe page.", timing: daily, noGateReason: "a morning read" });
  await w.defineJob({ id: "p7-probe-monday", title: "p7 probe: weekly on Monday", instructions: "Read the p7 probe page.", timing: { schedule: { kind: "weekly", days: [1], at: "09:00" }, zone: "Europe/London" }, noGateReason: "a weekly read" });
  await w.defineJob({ id: "p7-probe-off", title: "p7 probe: turned off", instructions: "Read the p7 probe page.", timing: daily, noGateReason: "a morning read" });
  await w.engine("p7-probe-off").disable("sam@solo-sam.example");
};

export const runs: Record<string, () => P7HarnessOptions> = {
  "T-P7-01": () => ({ script: [...oneShot] }),
  "T-P7-02": () => ({ seed: oneShotSeed, script: [...oneShot, report("It is seven minutes past three."), quiet] }),
  // A baseline tick (closed), a change read and certified silent, an unchanged tick (closed, no model), and a change
  // whose silence names a call the run never made: refused twice, the run fails and the failure wakes a quiet turn.
  "T-P7-03": () => ({
    seed: async (w) => void (await w.defineJob({ ...WATCH, timing: every(5), gate: { kind: "url", url: PROBE } })),
    script: [read("r1"), silent(["r1"]), silent(["r9"], "s2"), silent(["r9"], "s3"), quiet],
  }),
  // Two one-shots an hour out, each run now from the dialog: one reports, one ends with no terminal call.
  "T-P7-04": () => ({
    seed: async (w) => {
      await w.defineJob({ ...HOUR, timing: at("2026-10-13T12:00"), stop: { kind: "after_runs", runs: 1 } });
      await w.defineJob({ ...HOUR_FAILS, timing: at("2026-10-13T12:00"), stop: { kind: "after_runs", runs: 1 } });
    },
    script: [report("The p7 probe is done."), quiet, noTerminal, noTerminal, noTerminal, quiet],
  }),
  // The run held at its model step while Sam turns the job off; its late report is discarded.
  "T-P7-05": () => ({
    seed: async (w) => void (await w.defineJob({ ...HALF, timing: every(30), noGateReason: "the p7 probe has no change signal" })),
    script: [{ hold: "run", step: report("First paragraph.") }, quiet],
  }),
  "T-P7-06": () => ({
    seed: async (w) => void (await w.defineJob({ ...MORNING, timing: { schedule: { kind: "daily", at: "09:00" }, zone: "Europe/London" }, noGateReason: "a morning check runs every morning" })),
    script: [
      load,
      { toolCall: { id: "call_update", name: "jobs_update", arguments: { id: MORNING.id, schedule: { kind: "daily", at: "09:30" }, instructions: MOVED } } },
      callFrom((r) => ({ id: "call_enable", name: "jobs_enable", arguments: { id: idIn(r) } })),
      replyFrom(() => "Moved: the p7 probe now runs daily at 09:30 and checks the second paragraph."),
      { toolCall: { id: "call_pause", name: "jobs_disable", arguments: { id: MORNING.id } } },
      replyFrom(() => "Paused: the p7 probe will not run until you turn it on."),
      report("Second paragraph."),
      quiet,
    ],
  }),
  // A gate on a private host and an ungated recurring job are refused; the threshold gate over the probe is made.
  "T-P7-07": () => ({
    page: '{"count":30}',
    script: [
      load,
      { toolCall: { id: "call_private", name: "jobs_create", arguments: { ...COUNT, schedule: { kind: "interval", every_minutes: 10 }, gate: { kind: "threshold", url: "https://10.0.0.7/count", pointer: "/count", above: 40 } } } },
      { toolCall: { id: "call_bare", name: "jobs_create", arguments: { ...COUNT, schedule: { kind: "interval", every_minutes: 10 } } } },
      { toolCall: { id: "call_create", name: "jobs_create", arguments: { ...COUNT, schedule: { kind: "interval", every_minutes: 10 }, gate: { kind: "threshold", url: PROBE, pointer: "/count", above: 40 } } } },
      callFrom((r) => ({ id: "call_enable", name: "jobs_enable", arguments: { id: idIn(r) } })),
      replyFrom(() => "Watching the p7 probe every 10 minutes; I will tell you when the count passes 40."),
      report("The count on the p7 probe page passed 40: it reads 41."),
      quiet,
    ],
  }),
  // The job's instructions ask for a word; its checklist is complete, and silence is still refused (delta 2).
  "T-P7-08": () => ({
    seed: async (w) => void (await w.defineJob({ ...DONE_WORD, timing: every(30), noGateReason: "it answers every time" })),
    script: [read("r1"), silent(["r1"]), silent(["r1"], "s2"), silent(["r1"], "s3"), quiet],
  }),
  // Tier 2 (F30) under the scripted fake: the same runs a real model is graded on, so each file loads and plays here.
  "T-P7-09": () => ({ script: [...oneShot] }),
  "T-P7-10": () => ({ seed: oneShotSeed, script: [...oneShot, report("It is five past eleven."), quiet] }),
  "T-P7-11": () => ({
    seed: async (w) => void (await w.defineJob({ id: "p7-probe-unchanged", title: "p7 probe: say nothing if unchanged", instructions: "Read the p7 probe page. If nothing changed, say nothing.", timing: every(30), noGateReason: "the p7 probe has no change signal" })),
    script: [read("r1"), silent(["r1"]), read("r2"), silent(["r2"], "s2")],
  }),
  "T-P7-14": () => ({ seed: surfacesSeed, script: [] }),
  "T-P7-12": () => ({
    script: [answer("A job can read and report, but it cannot send anything anywhere, so I have not made one. I can send the words p7 probe to httpbin.org now, here in this chat, if you ask me to.")],
  }),
  // Two finished runs and a third held at its model step; Sam asks for the remove and decides its card.
  "T-P7-13": () => ({
    seed: async (w) => {
      await w.defineJob({ ...HALF, timing: every(30), noGateReason: "the p7 probe has no change signal" });
      await w.tick(HALF.title);
      await w.tick(HALF.title);
      await w.hold(HALF.title);
    },
    script: [
      report("First paragraph, one."),
      quiet,
      report("First paragraph, two."),
      quiet,
      { hold: "run", step: report("First paragraph, three.") },
      load,
      { toolCall: { id: "call_remove", name: "jobs_remove", arguments: { id: HALF.id } } },
      // The decided card's continuation, which the stop's notice joins (one model call answers both).
      replyFrom(() => "Removed the p7 probe: it will not run again, and its past runs are kept."),
    ],
  }),
};
