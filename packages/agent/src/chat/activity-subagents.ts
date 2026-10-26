// A task's sub-agent sections (F14): each delegation the task's turns launched or received is a section, numbered in
// creation order (`01`, `02`), its rows the parent's own `subagents` record nested by depth, so a coordinator's workers
// sit under it. The launch step's detail says, in code's words, what each request was and where it stands, from the
// rows; once the group's handoff has entered the chat, a synthesized `verdict` step carries the verifier's stored
// verdict and reason, the same stored value the chat handoff (`renderHandoff`) carries. A child's own steps live only
// in its facet's transcript, which the parent may read only under D-0011; until Kyle accepts that record no facet is
// read, and every row's steps are refused by name, never answered as an empty list (D-0001).
import type { SubAgentRow, SubAgentStore } from "../subagents/store.ts";
import type { TaskRecord } from "./activity.ts";
import type { StepRecord } from "./activity-steps.ts";
import { groupIdOf } from "./outbox.ts";

/** A child's steps are not read: D-0011 (the facet's transcript read) is not accepted. */
export const SUBAGENT_STEPS_UNAVAILABLE = "SUBAGENT_STEPS_UNAVAILABLE";

export type ChildSteps = StepRecord[] | { ok: false; code: string };

export interface SubAgentSectionRow {
  id: string;
  role: SubAgentRow["role"];
  depth: number;
  parent: string;
  brief: string;
  status: SubAgentRow["status"];
  code: string | null;
  verdict: SubAgentRow["verdict"];
  verdictReason: string | null;
  steps: ChildSteps;
}

export interface SubAgentSection {
  /** `01`, `02`, … in creation order within the task. */
  n: string;
  grp: string;
  /** The launch step's `n` in the parent's timeline; null when the timeline's cap hides it. */
  launchStep: number | null;
  rows: SubAgentSectionRow[];
}

/** What the sections read: the parent chat's own record of its sub-agents. */
export type SubAgentRows = Pick<SubAgentStore, "group" | "handedOffAt">;

/** The verifier's contract, said on every launch step. */
export const VERIFIER_CONTRACT = "Its handoff is checked by the verifier before it returns: pass, fail or unverified, with a reason.";

const statusWords = (r: SubAgentRow): string =>
  r.status === "failed" ? `failed (${r.code ?? "SUBAGENT_FAILED"})` : r.status === "waiting" ? "waiting on its workers" : r.status;

/** The launch step's paragraph: each request's role, its brief as text, its status from the row, whether results are back. */
export function launchProse(top: readonly SubAgentRow[]): string {
  const each = top.map((r, i) => `Sub-agent ${i + 1} is a ${r.role} with the brief "${r.brief}". It is ${statusWords(r)}, and its results are ${r.result !== null ? "back" : "not back yet"}.`);
  return [`Started ${top.length === 1 ? "1 sub-agent" : `${top.length} sub-agents`} on parts of this task.`, ...each, VERIFIER_CONTRACT].join(" ");
}

/** One returned delegation's verdict in words: the stored verdict of each request, a failure's code where it has none. */
const verdictWords = (r: SubAgentRow): string => r.verdict ?? statusWords(r);

function verdictStep(n: string, top: readonly SubAgentRow[], turnId: string, at: number): StepRecord {
  const title = `Sub-agent ${n} returned: ${top.map(verdictWords).join(", ")}`;
  const reasons = top.map((r) => r.verdictReason ?? (r.status === "failed" ? `It ended ${statusWords(r)}.` : "No verdict was stored."));
  const failed = top.find((r) => r.status === "failed");
  return {
    n: 0,
    turnId,
    callId: "",
    kind: "verdict",
    tool: "",
    title,
    state: failed ? "failed" : "done",
    code: failed?.code ?? null,
    startedAt: at,
    endedAt: at,
    durationMs: null,
    detail: { prose: top.length === 1 ? (reasons[0] as string) : reasons.map((reason, i) => `Sub-agent ${i + 1}: ${reason}`).join("\n"), blocks: [], result: null, lines: [], files: [], cut: false },
  };
}

/** The rows of one group, each parent before its children: a coordinator's workers follow it, by depth. */
function nested(rows: readonly SubAgentRow[]): SubAgentRow[] {
  const out: SubAgentRow[] = [];
  const visit = (parent: string) => {
    for (const r of rows) {
      if (r.parent !== parent) continue;
      out.push(r);
      visit(r.id);
    }
  };
  visit("main");
  return out;
}

/** Where a verdict step goes: after the launch turn's steps, before the first later step at or after the handoff, else before the tail. */
function verdictAt(steps: readonly StepRecord[], launch: number, at: number): number {
  const tail = steps.findIndex((s) => s.kind === "marker" || s.kind === "summary");
  const end = tail === -1 ? steps.length : tail;
  const launchTurn = steps[launch]?.turnId;
  for (let i = Math.max(launch + 1, 0); i < end; i++) {
    const s = steps[i] as StepRecord;
    if (s.turnId !== launchTurn && s.startedAt !== null && s.startedAt >= at) return i;
  }
  return end;
}

/**
 * The task's sub-agent sections and its timeline with each launch step's detail filled from the rows and each
 * returned delegation's verdict step in place, renumbered. Reads the parent's rows alone; no facet.
 */
export function subagentSections(store: SubAgentRows, task: TaskRecord, timeline: readonly StepRecord[]): { steps: StepRecord[]; subagents: SubAgentSection[] } {
  const groups = task.groups.map((grp) => ({ grp, rows: store.group(grp) })).filter((g) => g.rows.length > 0);
  groups.sort((a, b) => (a.rows[0] as SubAgentRow).createdAt - (b.rows[0] as SubAgentRow).createdAt);
  let steps = [...timeline];
  const sections = groups.map((g, i) => ({ n: String(i + 1).padStart(2, "0"), ...g, top: g.rows.filter((r) => r.parent === "main") }));
  for (const s of sections) {
    const launch = steps.findIndex((x) => x.callId !== "" && groupIdOf(x.turnId, x.callId) === s.grp);
    const launched = steps[launch];
    if (launched) steps[launch] = { ...launched, detail: { ...launched.detail, prose: launchProse(s.top) } };
    const at = store.handedOffAt(s.grp);
    if (at === null) continue;
    const where = launch === -1 ? verdictAt(steps, -1, Number.POSITIVE_INFINITY) : verdictAt(steps, launch, at);
    steps.splice(where, 0, verdictStep(s.n, s.top, launched?.turnId ?? task.turnIds.at(-1) ?? task.id, at));
  }
  steps = steps.map((x, i) => ({ ...x, n: i + 1 }));
  const subagents = sections.map((s) => {
    const launch = steps.find((x) => x.callId !== "" && groupIdOf(x.turnId, x.callId) === s.grp);
    const rows = nested(s.rows).map((r) => ({ id: r.id, role: r.role, depth: r.depth, parent: r.parent, brief: r.brief, status: r.status, code: r.code, verdict: r.verdict, verdictReason: r.verdictReason, steps: { ok: false as const, code: SUBAGENT_STEPS_UNAVAILABLE } }));
    return { n: s.n, grp: s.grp, launchStep: launch?.n ?? null, rows };
  });
  return { steps, subagents };
}
