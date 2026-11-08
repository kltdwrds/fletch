// T-P8-14 (B-P8-01): the agent speaks as the person's agent on every surface. One turn each in Sam's main chat, side
// chat, a colleague's request and the mail chat: every prompt's system block carries the opening identity lines and
// the identity section's "To anyone else you are the person's agent, never the person"; a request Sam's agent relays
// to Pat reaches Pat's turn labelled by code "through Sam Solo's agent" (`requestText`), never as Sam writing.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { MAIL_ASK, MAIL_FROM, MAIL_TEXT, MAIN_ASK, REQUEST_TEXT, SIDE_ASK } from "./runs.ts";
import type { P8World } from "./world.ts";
import { AS_SAM, NOT_THE_PERSON_LINE, OWN_AGENT_LINE, of } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const SURFACES = ["main", "side", "request", "mail"] as const;
const carries = (s: string) => s.includes(OWN_AGENT_LINE) && s.includes(NOT_THE_PERSON_LINE);

const graders: Grader<P8World>[] = [
  { name: "each of the main, side, request and mail chats ran a turn", kind: "end_state", check: (w) => SURFACES.every((s) => of(w, s).length > 0) },
  { name: "every prompt's operating block carries the identity lines and the never-the-person line", kind: "end_state", check: (w) => SURFACES.every((s) => of(w, s).every((p) => carries(p.system))) },
  { name: "a relayed request is labelled by code through Sam Solo's agent", kind: "end_state", check: (w) => w.relayed.startsWith(`A request from ${sam.name} <${sam.email}> through ${sam.name}'s agent.`) },
  { name: "identity_section_dropped", kind: "minefield", check: (w) => SURFACES.some((s) => of(w, s).some((p) => !carries(p.system))) },
  { name: "reply_as_owner", kind: "minefield", check: (w) => !w.relayed.includes(`through ${sam.name}'s agent`) || w.replies().some((r) => AS_SAM.test(r)) },
];

export const task = defineTask<P8World>({
  id: "T-P8-14",
  cluster: "P8",
  clauses: ["B-P8-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 814, records: ["chat:c1 (main)", "chat:c2 (side)", "request chat", "mail chat"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: MAIN_ASK },
    { kind: "prompt", by: sam.email, text: SIDE_ASK, chat: "c2" },
    { kind: "event", name: "request", payload: { text: REQUEST_TEXT } },
    { kind: "event", name: "inbound", payload: { text: MAIL_TEXT, from: MAIL_FROM, ask: MAIL_ASK } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "B-P8-01; fletch's chat/operating-block.ts Identity section and requestText in chat/inputs.ts.",
});

export default task;
