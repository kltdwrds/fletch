// The tier-1 runs of the P5 tasks (F31): each task's script and seed for `p5Harness`, shared by its `.test.ts`, by
// `planted.test.ts`, which plays the same runs with the fault planted, and by `tier2-fake.test.ts`. One script serves
// every model call in the order they come; a run with sub-agents is `routed`, so each child, each verifier and the chat
// are answered by what their request is, whatever order the host runs them in.
import { type FakeRequest, type FakeStep, report } from "../../support/fake-model.ts";
import { CHILD_MARK, JOB_TASK_MARK, type P5HarnessOptions, type P5Tier1World, pat, toolResults, VERIFIER_MARK } from "./harness.ts";
import { DEAD, PROBE } from "./world.ts";

import { ASK, MAIL, OTHER } from "./request-shows-as-task.task.ts";

export { ASK, MAIL, OTHER };
export const BOTH = `Read ${PROBE} and ${DEAD} and write their titles to p5-probe.md`;
export const FILE = "The p5 probe page\n1 link";

export const load = (...names: string[]): FakeStep => ({ toolCall: { id: `load_${names.join("_")}`, name: "tool_search", arguments: { load: names } } });
export const read = (url: string, id: string): FakeStep => ({ toolCall: { id, name: "browse_open", arguments: { url } } });
export const write = (id = "w1", text = FILE): FakeStep => ({ toolCall: { id, name: "file_write", arguments: { path: "p5-probe.md", text } } });
const mail = (id = "m1"): FakeStep => ({ toolCall: { id, name: "mail_send", arguments: { body: "The probe notes." } } });
export const held = (step: FakeStep): FakeStep => ({ hold: "mid", step });

export const REPLY = "I wrote the page's title and its 1 link to p5-probe.md.";
export const TWO = "It has two links; I wrote them down in p5-probe.md.";
export const PLAIN = "No page came back from that address, so I have nothing from it to tell you.";
export const ACK = "I have asked a sub-agent to count the sentences on that page; I will tell you when it reports back.";
export const COUNTED = "The sub-agent counted 2 sentences on the page.";
/** What the child hands off. */
export const CHILD = "2 sentences";

/** A turn a job's notice wakes, with nothing to add (F24). */
const quiet: FakeStep = { text: "" };
const sent = (r: FakeRequest) => JSON.stringify((r.inputs as { messages?: unknown[] }).messages ?? []);
/** A child's next step: read the page its brief names, then hand off `handoff`. */
const childStep = (r: FakeRequest, handoff: string): FakeStep => {
  const results = toolResults(r);
  if (results.some((t) => t.includes(PROBE) && t.includes("links"))) return { text: handoff };
  return read(PROBE, `c${results.length + 1}`);
};
/**
 * A script where each child and verifier request is answered by what it is, and every other request takes the next of
 * `chat`'s steps in order. `spare` is how many child and verifier calls the run may make.
 */
export function routed(chat: FakeStep[], o: { handoff?: string; verdict?: "pass" | "fail"; spare?: number; jobs?: FakeStep[] } = {}): FakeStep[] {
  const queue = [...chat];
  const jobs = [...(o.jobs ?? [])];
  const step: FakeStep = {
    fromRequest: (r) => {
      // A job's step takes the next job step; a turn a job's notice wakes, once the chat's steps are spent, adds nothing.
      if (sent(r).includes(JOB_TASK_MARK)) return jobs.shift() ?? { text: "" };
      if (o.jobs && !queue.length) return quiet;
      if (sent(r).includes(VERIFIER_MARK)) return { text: JSON.stringify({ verdict: o.verdict ?? "pass", reason: "answers the brief from the page" }) };
      if (sent(r).includes(CHILD_MARK)) return childStep(r, o.handoff ?? CHILD);
      const next = queue.shift();
      if (!next) throw new Error("P5_SCRIPT_SPENT: a chat request with no step left");
      return next;
    },
  };
  return Array.from({ length: chat.length + (o.jobs?.length ?? 0) + (o.spare ?? 0) }, () => step);
}
export const delegate = (tasks: string[], id = "d1"): FakeStep => ({ toolCall: { id, name: "subagents_delegate", arguments: { tasks: tasks.map((brief) => ({ role: "worker", brief })) } } });
export const BRIEF = `Count the sentences on ${PROBE}.`;

/** A job's `page_read` of the probe page, and its certified silence. */
const pageRead: FakeStep = { toolCall: { id: "j1", name: "page_read", arguments: { url: PROBE } } };
const silent: FakeStep = { toolCall: { id: "s1", name: "nothing_to_report", arguments: { work: "read the p5 probe page", material_result: false, evidence: ["j1"], dependencies: [{ tool: "page_read", available: true, workaround: false }], watermark: "p5 probe seen" } } };

export const JOBS = {
  reports: { id: "p5-reports", title: "p5 probe: say it is up", instructions: "Tell me the p5 probe is up." },
  quiet: { id: "p5-quiet", title: "p5 probe: say nothing if unchanged", instructions: "Read the p5 probe page; if nothing changed, say nothing." },
  lost: { id: "p5-lost", title: "p5 probe: report to a chat that refuses", instructions: "Tell me the p5 probe is up." },
};
const at = (local: string) => ({ schedule: { kind: "runonce" as const, at: local }, zone: "Europe/London" });

export const AUDIT = "What did you create, change or delete in this chat?";
export const JOB_TITLE = "p5 probe: the morning check";
export const MEMORY = "The p5 probe page is for the p5 check.";
export const LISTED = `I wrote p5-probe.md, set the job ${JOB_TITLE}, launched two sub-agents and saved one memory line.`;

export const runs: Record<string, () => P5HarnessOptions> = {
  "T-P5-01": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: REPLY }, { text: "Friday." }, mail(), { text: "Sent." }] }),
  "T-P5-02": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: REPLY }] }),
  // The first turn held before its reply; the second held after its read, while Sam presses Stop.
  "T-P5-03": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), held({ text: REPLY }), read(PROBE, "r2"), held({ text: "The page has two sentences." })] }),
  "T-P5-04": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: TWO }, { text: "Friday." }, mail(), { text: "Sent." }] }),
  // Held after the first read, while the turn still runs.
  "T-P5-05": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), held(read(DEAD, "r2")), write(), { text: "I read both pages and wrote the titles down." }] }),
  "T-P5-06": () => ({ script: [load("browse"), read(DEAD, "r1"), { text: PLAIN }] }),
  "T-P5-07": () => ({
    script: [
      load("browse"), read(PROBE, "r1"), read(DEAD, "r2"), { text: "The first is The p5 probe page; no page came back from the second." },
      read(PROBE, "r3"), read(DEAD, "r4"), { text: "The same again: The p5 probe page, and nothing from the second." },
      read(PROBE, "r5"), { text: "The p5 probe page." },
      { status: 400, message: "the model refused the request" },
    ],
  }),
  "T-P5-08": () => ({
    // c1's delegation and its handoff; then c2's, held before its acknowledgement while Sam presses Stop.
    script: routed([load("subagents"), delegate([BRIEF]), { text: ACK }, { text: COUNTED }, load("subagents"), delegate([BRIEF], "d2"), held({ text: ACK }), { text: "" }], { spare: 8 }),
  }),
  "T-P5-09": () => ({
    seed: async (w: P5Tier1World) => {
      const patChat = ((await w.w.host(pat.email).chats.main(w.w.clock.now)) as { chatId: string }).chatId;
      await w.defineJob({ ...JOBS.reports, timing: at("2026-10-13T11:05") });
      await w.defineJob({ ...JOBS.quiet, timing: at("2026-10-13T11:10"), noGateReason: "the p5 probe has no change signal" });
      await w.defineJob({ ...JOBS.lost, timing: at("2026-10-13T11:15"), chat: patChat });
    },
    script: routed([], { jobs: [report("The p5 probe is up."), pageRead, silent, report("The p5 probe is up.")], spare: 6 }),
  }),
  "T-P5-10": () => ({
    script: routed(
      [
        load("browse", "files"), read(PROBE, "r1"), write(), { text: "Wrote p5-probe.md." },
        load("jobs"), { toolCall: { id: "j1", name: "jobs_create", arguments: { title: JOB_TITLE, instructions: "Tell me to check the p5 probe.", schedule: { kind: "daily", at: "09:00" }, no_gate_reason: "a reminder has no change signal" } } }, { text: "Set." },
        load("subagents"), delegate([BRIEF, `Find the link on ${PROBE}.`]), { text: "Two sub-agents are on it." }, { text: "Both reported back." },
        { toolCall: { id: "mw1", name: "memory_write", arguments: { target: "daily", text: MEMORY } } }, { text: "Saved." },
        { text: LISTED },
      ],
      { spare: 8 },
    ),
  }),
  "T-P5-11": () => ({ script: [mail(), { text: "Sent." }, { text: "Friday." }] }),
  // Tier 2 under the scripted fake (`tier2-fake.test.ts`); on a slot the real model answers instead.
  "T-P5-12": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: REPLY }] }),
  "T-P5-13": () => ({ script: [load("browse"), read(PROBE, "r1"), read(DEAD, "r2"), { text: "The first page is The p5 probe page, with one line of text and one link. No page came back from the second address, so I have nothing from it." }] }),
  "T-P5-14": () => ({ script: routed([load("subagents"), delegate([BRIEF]), { text: ACK }, { text: COUNTED }], { spare: 4 }) }),
  "T-P5-15": () => ({ script: [load("browse", "files"), read(PROBE, "r1"), write(), { text: REPLY }] }),
};
