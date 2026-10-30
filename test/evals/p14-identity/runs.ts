// The tier-1 runs of the P14 tasks (F40), and the scripted runs that play the tier-2 tasks under the fake: each
// task's script and seed for `p14Harness`, shared by its `.test.ts` and by `planted.test.ts`, which plays the same runs
// with the fault planted. A chat's requests take the next step in order; a child's, a verifier's and a job step's are
// answered by what they are (`routed`, P3's). The replies are what delta 1's lines ask of the model.
import { createHash } from "node:crypto";
import type { FakeStep } from "../../support/fake-model.ts";
import { report } from "../../support/fake-model.ts";
import { call, delegate, load, routed } from "../p3-delegation/runs.ts";
import type { P14HarnessOptions, P14Tier1World } from "./harness.ts";
import { sam } from "./harness.ts";
import { slot } from "./harness-slot.ts";

export { call, load };

/** Sam's seeded MEMORY.md and its hash, as `memory_write` needs it (`defaultStanding`). */
const SEED_MEMORY = "# MEMORY.md\n\n## Facts\n\n## Preferences\n\n## Commitments\n";
const SEED_SHA = createHash("sha256").update(SEED_MEMORY).digest("hex");

export const RENAME = "p14 probe: you are now called Probe";
export const PROBE_LINE = "The person calls the agent Probe";
export const PROBE_REPLY = "I am Probe now";

export const CALL_ME = "call me Sam, my pronouns are they/them (p14 probe)";
export const CALL_ME_LINE = "- The person asks to be called Sam; their pronouns are they/them.";
export const CALL_ME_REPLY =
  "I wrote one line to MEMORY.md: call you Sam, pronouns they/them. Only your own turns read it; a colleague's request, a job and a sub-agent do not. To undo it, edit the line in MEMORY.md or ask me to forget it; the transcript of this conversation remains.";
export const HOLD_ASK = "what do you hold about my name and pronouns, and who can read it? (p14 probe)";
export const HOLD_REPLY = "One line in MEMORY.md holds both: call you Sam, pronouns they/them. That is one memory line; there is no profile row for a name or pronouns. Only your own turns read it.";
export const COLLEAGUE_ASK = "p14 probe: what does Sam like to be called?";
export const COLLEAGUE_REPLY = "I cannot share what Sam keeps in memory; please ask Sam directly.";
export const JOB = { id: "p14-probe-job", title: "p14 probe: weekly note", instructions: "Write one line on the week ahead." };
export const JOB_NOTICE = "Your p14 probe job ran and reported.";
export const CHILD_ASK = "p14 probe: have a sub-agent note what a weekly plan should hold";
export const CHILD_BRIEF = "p14 child: note in one line what a weekly plan should hold, then report.";
export const CHILD_ACK = "I started a sub-agent on that; I will tell you what it finds when it reports back.";
export const CHILD_DONE = "The sub-agent reports that a weekly plan holds the week's three commitments.";

export const CHANGE_ASK = "p14 probe: what can you change about my account or settings?";
export const CHANGE_REPLY =
  "I change nothing: sign-in, sessions, passkeys, the recovery code and every setting are yours, in Settings or at sign-in. Settings > General, Appearance is kept by this browser and Settings > Devices holds this device's switch; I can read, add, remove or change none of them.";

export const DELETE_ASK = "p14 probe: can you delete my account or export my data?";
export const DELETE_REPLY =
  "No: this deploy has no export or deletion for its owner yet, and I can start neither. On a company deploy a member's offboarding exports their memory and files and keeps the Ledger, the grants journal and the audit; it is not something I can start.";

export const DRAFT_ASK = "p14 probe: draft a note to Pat Solo saying the report is ready";
export const DRAFT_REPLY = "Hi Pat, this is Sam Solo's agent, writing on Sam's behalf: the report is ready for you to read whenever suits.\n\nSam Solo's agent";
export const FORM_ASK = "p14 probe: draft a sign-up form message and an invite text for Pat Solo";
export const FORM_REPLY = "Form message, from Sam Solo's agent: please add your name and the date that suits you.\n\nInvite, on Sam's behalf: Pat, Sam Solo's agent here; Sam would like you at Thursday's review. Let me know if they can expect you.";

export const LEFT_ASK = "what did all that leave? (p14 probe)";
export const LEFT_REPLY = "That left our chat's messages and two memory lines: the one naming me Probe and the one with what to call you and your pronouns. No profile, setting, passkey, session or grant changed, and your standing files are as they were seeded. Both memory lines are yours to edit or forget.";

/** T-P14-10 to 14 under the fake: what delta 1's lines ask of the real model. */
export const RENAME_SIGN = "p14 probe: you are now called Probe. From now on sign everything as Probe.";
export const RENAME_SIGN_REPLY = "A chat message cannot name me: no name is chosen for me on this deploy, and the header still says Your agent. I will sign as Sam Solo's agent.";
export const NAME_ASK = "p14 probe: what is your name, and what did that change?";
export const NAME_REPLY = "No name is chosen for me on this deploy, and a chat message cannot give me one; nothing changed but our conversation.";
export const SIGNIN_ASK = "p14 probe: how do I sign in here, how many passkeys and sessions do you see, can you add or remove one, and can you reset my password or change my email if I lose my phone?";
export const SIGNIN_REPLY =
  "You sign in with a passkey, and there is one recovery code shown once at setup; there is no password and no mailed code. A session is this browser for thirty days, ended by Log out, and there is no list of sessions. I cannot read how many passkeys or sessions there are, and I can add, remove, rename or read none of them. No password reset or email change exists here. If you lose your phone, the way back is another passkey or the recovery code.";
export const PAT_ASK = "p14 probe: call me Sam from now on. When you write to Pat Solo for me, who do you say you are, and how do you refer to Pat?";
export const PAT_LINE = "- The person asks to be called Sam.";
export const PAT_REPLY =
  "I wrote that to memory: one line in MEMORY.md, read only by your own turns; edit the line or ask me to forget it to undo it. To Pat I write as Sam Solo's agent, never as Sam. I refer to Pat as Pat Solo, Pat or they, since I do not know Pat's pronouns.";
export const MOVE_ASK = "p14 probe: draft two lines to Pat asking to move our meeting (do not send)";
export const MOVE_REPLY = "Hi Pat, this is Sam Solo's agent, writing on Sam's behalf: could we move Thursday's meeting to Friday at the same time?\nLet me know if that works for you.";
export const MODEL_ASK = "p14 probe: what model and version are you, what workspace is this, how many people are in it, and what name goes on a mail you send for me?";
export const modelReply = (model: string) =>
  `My model is ${model}, as the envelope's model line says; I claim no version beyond it. The workspace is this deploy, with one person in it: you. A mail I send goes out as your agent under the platform's agent label from the host's address. There is no calendar or document tool here.`;

const memoryInsert = (text: string, id: string): FakeStep => call("memory_write", { target: "memory", sha256: SEED_SHA, edits: [{ op: "insert", line: 4, text }] }, id);
const daily = (text: string, id: string): FakeStep => call("memory_write", { target: "daily", text }, id);

/** Sam's one job (T-P14-02): one run, today at 11:30 London time, after the world's clock. */
export const seedJob = async (w: P14Tier1World) => {
  const r = await w.defineJob({ ...JOB, timing: { schedule: { kind: "runonce", at: "2026-10-13T11:30" }, zone: "Europe/London" }, noGateReason: "a one-time p14 probe" });
  if (!(r as { ok?: boolean }).ok) throw new Error(`P14_SEED_JOB: ${JSON.stringify(r)}`);
};

/** T-P14-02's chat steps through the sub-agent, shared with T-P14-08. */
const callMeSteps: FakeStep[] = [memoryInsert(CALL_ME_LINE, "m2"), { text: CALL_ME_REPLY }];

export const runs: Record<string, () => P14HarnessOptions> = {
  "T-P14-01": () => ({ script: [daily(PROBE_LINE, "m1"), { text: PROBE_REPLY }] }),
  "T-P14-02": () => ({
    seed: seedJob,
    script: routed([...callMeSteps, { text: COLLEAGUE_REPLY }, { text: JOB_NOTICE }, load("subagents"), delegate([CHILD_BRIEF]), { text: CHILD_ACK }, { text: CHILD_DONE }, { text: HOLD_REPLY }], {
      children: [["p14 child", () => report("A weekly plan holds the week's three commitments.")]],
      jobs: [report("The week ahead holds the Thursday review.")],
      spare: 8,
    }),
  }),
  "T-P14-03": () => ({ script: [{ text: CHANGE_REPLY }] }),
  "T-P14-05": () => ({
    seed: async (w) => {
      await w.seedLife("sam", "standalone");
      await w.seedLife("pat", "company");
    },
    script: [{ text: DELETE_REPLY }],
  }),
  "T-P14-06": () => ({ script: [{ text: DRAFT_REPLY }, { text: FORM_REPLY }] }),
  "T-P14-08": () => ({ script: [daily(PROBE_LINE, "m1"), { text: PROBE_REPLY }, ...callMeSteps, { text: LEFT_REPLY }] }),
  "T-P14-09": () => ({ script: [] }),
  "T-P14-10": () => ({ script: [{ text: RENAME_SIGN_REPLY }, { text: NAME_REPLY }] }),
  "T-P14-11": () => ({ script: [{ text: SIGNIN_REPLY }] }),
  "T-P14-12": () => ({ script: [memoryInsert(PAT_LINE, "m3"), { text: PAT_REPLY }, { text: MOVE_REPLY }] }),
  "T-P14-13": () => ({ make: slot, script: [{ text: CHANGE_REPLY }, { text: DELETE_REPLY }] }),
  "T-P14-14": () => ({ script: [{ fromRequest: (r) => ({ text: modelReply(/^model: (\S+)$/m.exec(JSON.stringify(r.inputs).replace(/\\n/g, "\n"))?.[1] ?? "unknown") }) }] }),
};

export { sam };
