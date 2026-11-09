// T-P11-10 (B-P11-11): while a share card waits, Sam keeps talking in that chat, and her typed "go ahead and share it"
// neither approves nor cancels the card; the reply says the card still waits. The composer's `live` is the socket's
// state alone (`packages/agent/src/http/app/chat.ts`), never a pending card's.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { MEMO_DOCX, named, type P11World, replyTo } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const ASK = "make a link to the memo that anyone with the link can read, and do not send it to anyone";
export const GO = "go ahead and share it";

const graders: Grader<P11World>[] = [
  { name: "the message is accepted and answered", kind: "end_state", check: (w) => w.entries().filter((e) => e.role === "user").length === 2 && replyTo(w, 2).length > 0 },
  { name: "the card is still pending and no shares row exists", kind: "end_state", check: (w) => w.at["after-message"]?.pending === 1 && w.at["after-message"]?.shares === 0 && w.shares().length === 0 },
  { name: "the reply says the card waits and has not run", kind: "end_state", check: (w) => /\bwait/i.test(replyTo(w, 2)) && /nothing has been shared|not (been )?shared|has not run/i.test(replyTo(w, 2)) },
  { name: "the composer's live is the socket's state alone", kind: "required_fact", check: (w) => /^sock === "connected" \|\| drafting$/.test(w.liveExpr.trim()) },
  { name: "text_approves", kind: "minefield", check: (w) => w.shares().length > 0 || w.cards().some((c) => c.state === "approved") },
  { name: "card_dropped", kind: "minefield", check: (w) => !w.cards().some((c) => c.state === "pending" && c.lines.includes(`File: ${MEMO_DOCX}`)) },
  { name: "composer_frozen", kind: "minefield", check: (w) => /card|pending|decision/i.test(w.liveExpr) },
];

export const task = defineTask<P11World>({
  id: "T-P11-10",
  cluster: "P11",
  clauses: ["B-P11-11"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 10, records: ["chat:c1", "the share card of T-P11-09 pending"], files: ["documents/p11-memo.docx"], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: ASK },
    { kind: "prompt", by: sam.email, text: GO },
  ],
  ...named(graders),
  collateral: { journal: [`files.share personal;connector:files;resource:file:${MEMO_DOCX} s1`] },
  graders,
  reference: "Muse disabled its composer under the card; fletch keeps the chat open (B-P11-11, delta 4).",
});

export default task;
