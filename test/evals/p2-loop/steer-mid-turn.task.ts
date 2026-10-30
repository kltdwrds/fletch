// T-P2-05 (B-P2-05): Sam's message during a running turn is framed `queued` at once and folded into that turn at its
// next step boundary: the harness's steer line (`STEER_POLICY`) and the message in a `person:` fence, after the
// completed tool results; one reply answers the steered work (Translation, delta 3: fletch keeps the turn where Muse
// ends it). Every send is a mailbox row in fletch, the first one too, so the mail rows are two.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { ModelRequest, P2World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "Count the files in each of the four folders.";
export const STEER = "only the .md ones";
/** The opening of `STEER_POLICY` (`packages/agent/src/chat/mailbox.ts`; the test checks). */
export const STEER_LINE = "(From the harness, not a reply to your last step.)";
const FENCED = `[BEGIN EXTERNAL CONTENT source="person:${sam.email}"]\n${STEER}\n[END EXTERNAL CONTENT source="person:${sam.email}"]`;

/** The first request after the steer was sent, and the user message in it that carries the steer line. */
function steered(w: P2World): { request: ModelRequest | undefined; at: number } {
  const request = w.requests()[w.turnStarts()[1] ?? -1];
  return { request, at: request?.messages.findIndex((m) => m.role === "user" && m.text.startsWith(STEER_LINE)) ?? -1 };
}
const toolsBefore = (r: ModelRequest | undefined, at: number) => (r?.messages.slice(0, at) ?? []).filter((m) => m.role === "tool").length;

export const task = defineTask<P2World>({
  id: "T-P2-05",
  cluster: "P2",
  clauses: ["B-P2-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 5, records: ["chat:c1"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "prompt", by: sam.email, text: STEER },
  ],
  end_state: [
    "the steer is framed queued at once",
    "the next request carries the steer line and the fenced steer, after the completed tool results",
    "the turn's reply is the only agent entry and answers the steered task",
    "the transcript holds Sam's two messages and one agent message, in one turn",
  ],
  required_facts: ["the steer line says the message is from the harness and not a reply to the last step"],
  minefields: ["queued_until_done", "two_replies", "work_lost", "steer_unfenced"],
  collateral: { journal: ["mail:c1:1:user", "mail:c1:2:user", "message:c1:1:you", "message:c1:2:you", "message:c1:3:agent", "turn:c1:1"] },
  graders: [
    {
      name: "the steer is framed queued at once",
      kind: "end_state",
      check: (w) => {
        const q = w.frames().findIndex((f) => f.type === "queued" && f.text === STEER);
        const third = w.marks().find((m) => m.n === 3);
        return q >= 0 && third !== undefined && q < third.frames;
      },
    },
    {
      name: "the next request carries the steer line and the fenced steer, after the completed tool results",
      kind: "end_state",
      check: (w) => {
        const { request, at } = steered(w);
        return at >= 0 && request?.messages[at]?.text.endsWith(FENCED) === true && toolsBefore(request, at) === 3 && at === (request?.messages.length ?? 0) - 1;
      },
    },
    {
      name: "the turn's reply is the only agent entry and answers the steered task",
      kind: "end_state",
      check: (w) => {
        const agent = w.entries().filter((e) => e.kind === "agent");
        return agent.length === 1 && (agent[0]?.text ?? "").includes(".md");
      },
    },
    {
      name: "the transcript holds Sam's two messages and one agent message, in one turn",
      kind: "end_state",
      check: (w) => JSON.stringify(w.entries().filter((e) => e.kind === "you").map((e) => e.text)) === JSON.stringify([PROMPT, STEER]) && w.entries().filter((e) => e.kind === "agent").length === 1 && w.turns().length === 1,
    },
    { name: "the steer line says the message is from the harness and not a reply to the last step", kind: "required_fact", check: (w) => steered(w).at >= 0 },
    { name: "queued_until_done", kind: "minefield", check: (w) => w.turns().length > 1 || w.mailbox().find((m) => m.ordinal === 2)?.delivery !== "steer" },
    { name: "two_replies", kind: "minefield", check: (w) => w.entries().filter((e) => e.kind === "agent").length > 1 },
    {
      name: "work_lost",
      kind: "minefield",
      check: (w) => {
        const { request, at } = steered(w);
        return toolsBefore(request, at) < 3;
      },
    },
    {
      name: "steer_unfenced",
      kind: "minefield",
      check: (w) => {
        const { request } = steered(w);
        const said = (request?.messages ?? []).filter((m) => m.role === "user").map((m) => m.text.split(FENCED).join(""));
        return said.some((t) => t.includes(STEER));
      },
    },
  ],
  reference: "Muse steps 3 and 4 (`answers/step-3.md` 2, `answers/step-5.md` 4: the interruption note verbatim); fletch folds the steer into the running turn instead of ending it (delta 3).",
});

export default task;
