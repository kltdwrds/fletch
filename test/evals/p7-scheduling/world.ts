// The P7 world as the scheduling tasks read it (F29, `docs/plan-v2/contracts/P7-scheduling.md`). Every grader of a
// `.task.ts` in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a task
// module loads under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's `scheduler.jobs` row
// and `cron_mutations` are a Job Durable Object's record (its definition, its earlier definitions and its runs); Muse's
// `delivery_outbox` is the job's outbox; the "Scheduled task" card is the job's approval card under the creating reply
// (a job the agent registers starts off until Sam turns it on there); the hook is the gate on a recurring job (delta 3);
// the run-time approval card is absent by design, since a job cannot act (delta 4).
import type { ScenarioWorld } from "../../support/scenario.ts";

/** `c1` is Sam's chat, the one every job is asked for in. */
export type ChatLabel = "c1";

/** One of Sam's jobs as its Job object holds it. */
export interface JobView {
  id: string;
  title: string;
  status: string;
  /** The status in `JOB_STATUS_WORDS`' words. */
  words: string;
  /** The cadence said in words in the job's zone (`describeCadence`). */
  cadence: string;
  kind: string;
  /** A one-shot's local slot, `YYYY-MM-DDTHH:MM` in its zone. */
  at: string | null;
  every: number | null;
  zone: string;
  stop: { kind: string; runs?: number };
  owner: { kind: string; id: string };
  /** The chat its results go to, by label; the raw id when it is none of the world's. */
  chat: string;
  gate: { kind: string; url?: string; pointer?: string; above?: number; below?: number } | null;
  instructions: string;
  /** The definitions it had before each change in place, oldest first. */
  history: Array<{ until: number; by: string; cadence: string; instructions: string; at: string | null }>;
  /** The Job object's armed alarm, or null. */
  alarmAt: number | null;
  /** The watermark the last certified silence wrote, or null. */
  mark: string | null;
}

export interface RunView {
  /** The job's title. */
  job: string;
  manual: boolean;
  phase: string;
  signal: string | null;
  code: string | null;
  reason: string | null;
  scheduledFor: number;
}

export interface OutboxView {
  job: string;
  run: string | null;
  state: string;
  text: string;
}

/** A notice drawn in a chat, with the job's title it came from (`job:<id>`), or its raw source. */
export interface NoticeView {
  text: string;
  from: string;
}

export interface CardView {
  state: string;
  title: string;
  lines: string[];
  /** The tool the card asks to run. */
  tool: string;
}

/** A row of the app's job route as the Upcoming tab reads it. */
export interface ListedJob {
  id: string;
  title: string;
  /** `upcoming` drawn under its cadence, `off` under Off, `none` not drawn. */
  listed: string;
  words: string;
  kind: string | null;
  nextRun: number | null;
}

/** The job dialog as the panel draws it for one job, read from the page. */
export interface DialogView {
  state: string;
  title: string;
  words: string;
  /** The job's instructions as the dialog draws them. */
  about: string;
  /** The text of every control in the dialog, in order. */
  controls: string[];
  /** Each line of the run history, runs first and then the earlier definitions. */
  history: string[];
  /** Whether any element of the dialog other than its own controls answers a click. */
  otherClickable: boolean;
  /** Whether the run history is open (its toggle's `aria-expanded`). */
  historyOpen: boolean;
}

/** One model request: which side made it, and the tool names it offered. */
export interface ModelCall {
  side: "chat" | "job";
  tools: string[];
  /** A chat request woken by a job's notice (F24's handoff), not by Sam. */
  handoff: boolean;
}

export interface P7World extends ScenarioWorld {
  /** The test's clock. */
  now(): number;
  /** The instant the world started at. */
  start(): number;
  jobs(): JobView[];
  runs(): RunView[];
  outbox(): OutboxView[];
  notices(chat?: ChatLabel): NoticeView[];
  /** The agent's visible replies in the chat, in order. */
  replies(chat?: ChatLabel): string[];
  /** Each tool result in the chat's transcript, in order. */
  results(chat?: ChatLabel): Array<{ tool: string; text: string; isError: boolean }>;
  cards(): CardView[];
  /** The app's job route for Sam. */
  listed(): Promise<ListedJob[]>;
  /** The job dialog for the job titled `title`, opened in Sam's page from the Upcoming tab, or null when no row opens it. */
  dialog(title: string): Promise<DialogView | null>;
  /** Every request the job network was sent, with whether it carried any credential or authorization header. */
  egress(): Array<{ url: string; credentialed: boolean }>;
  calls(): ModelCall[];
  /** What a job's model step may run, as production wires it: the tools a job's model is offered that `readOnlyForJob` passes. */
  jobTools(): string[];
  /** Approvals raised by a job run (an approval step waiting), across Sam's jobs. */
  runApprovals(): number;
  /** After each turn, in order: the turn (`prompt`, `event:tick`), the titles Upcoming listed then, and the runs and model calls so far. */
  after(): Array<{ turn: string; upcoming: string[]; runs: number; calls: number }>;
  /** The job dialog as each `panel` turn left it, with the action's result line. */
  readonly acted: Array<DialogView & { result: string }>;
  /** The Upcoming tab's group titles as Sam's page draws them. */
  groups(): Promise<string[]>;
  /** Whether, at phone width, the panel opens as a bottom sheet. */
  phoneSheet(): Promise<boolean>;
}

/** Sam's replies joined. */
export const replyOf = (w: P7World): string => w.replies().join("\n");

/** The one job titled `title`. */
export const jobNamed = (w: P7World, title: string): JobView | undefined => w.jobs().find((j) => j.title === title);

/** The runs of the job titled `title`. */
export const runsOf = (w: P7World, title: string): RunView[] => w.runs().filter((r) => r.job === title);

/** The page the fake network serves, and the only url a gate may read. */
export const PROBE = "https://example.com/p7-probe";

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/** The fixed controls of the job dialog, by id: close, the run history's toggle, Run now, Turn off or on, Remove. */
export const DIALOG_CONTROLS = ["job-back", "job-runs-toggle", "job-run", "job-toggle", "job-remove"];

/** Whether a dialog draws only its fixed controls and nothing else that answers a click (D22: model text is never a control). */
export const fixedControls = (d: DialogView): boolean => !d.otherClickable && d.controls.every((c) => DIALOG_CONTROLS.includes(c));

/** The notices a job's run left in the chat. */
export const noticesOf = (w: P7World, title: string): NoticeView[] => w.notices().filter((n) => n.from === title);

/** `HH:MM` of a one-shot's local slot. */
export const clockOf = (at: string | null): string => (at ? at.slice(11, 16) : "");
