// A colleague's request arriving at this person's agent (M7.1, authority-model.md "Delegation both
// ways"). The `Person` is the owning store of who may ask: the sender and the origin must be members
// of this company now, by the `Company`'s table; a request from anyone else (another company's member)
// is refused and journaled. An accepted request runs in a chat of its own, owned by this person,
// labeled as from the colleague, under the colleague's origin and hop count; the reply is code's.
import type { ColleagueRequest, RequestOutcome } from "../colleagues/tools.ts";
import type { Member } from "../company/members.ts";
import { type JournalRow, partyRef } from "../grants/journal.ts";
import type { OpenResult } from "./chats.ts";
import { log } from "../obs/log.ts";

/** Requests past this many agents are refused outright; resolution already caps them at ask past one. */
export const MAX_HOPS = 3;
export const MAX_REQUEST_CHARS = 4000;

export interface RequestRun extends ColleagueRequest {
  requestId: string;
}

export interface RequestDeps {
  person: string;
  lookup(email: string): Promise<Member | null>;
  openChat(): Promise<OpenResult>;
  run(chatId: string, r: RequestRun): Promise<{ status: string; text: string } | { status: "refused"; code: string }>;
  journal(row: JournalRow): Promise<unknown>;
  now(): number;
  /**
   * Keeps the request's attachments as the sender's, with the request's audience, in this person's table
   * (M24.3) and answers the model's line for each; absent, a request carrying any is refused.
   */
  attach?(r: { from: string; origin: string; requestId: string; chatId: string; refs: unknown }): { ok: true; lines: string[] } | { ok: false; code: string; reason: string };
}

export async function receiveRequest(deps: RequestDeps, r: ColleagueRequest): Promise<RequestOutcome> {
  const refuse = async (code: string, reason: string): Promise<RequestOutcome> => {
    const at = deps.now();
    const sender = typeof r.from === "string" ? r.from.trim().toLowerCase() : "";
    // A refusal from an identifiable sender is journaled under them; nothing of the text is kept.
    if (/^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(sender)) {
      await deps.journal({
        id: `request-refused:${deps.person}:${at}:${sender}`, at, actor: `${r.viaAgent ? "agent" : "person"}:${sender}`, principal: deps.person,
        actionKind: "colleagues.request", subjectRef: `personal;resource:colleague:${deps.person}`, counterpart: partyRef({ kind: r.viaAgent ? "agent-of-person" : "person", id: sender }),
        origin: /^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(r.origin) ? r.origin : sender, hops: Number.isInteger(r.hops) && r.hops >= 0 && r.hops <= 16 ? r.hops : 0,
        decision: "deny", grantId: null, outcome: code, runId: `request:${at}`, tokens: 0,
      });
    }
    log("colleague.request.refused", { person: deps.person, code });
    return { ok: false, code, reason };
  };
  if (r.to !== deps.person) return refuse("REQUEST_MISADDRESSED", "this agent acts for someone else");
  if (!(await deps.lookup(r.from))) return refuse("COLLEAGUE_NOT_A_MEMBER", "the sender is not a member of this company");
  if (!(await deps.lookup(r.origin))) return refuse("COLLEAGUE_NOT_A_MEMBER", "the request started with someone outside this company");
  if (r.from === deps.person || r.origin === deps.person) return refuse("REQUEST_TO_SELF", "a person's own requests go to their agent in chat");
  if (!Number.isInteger(r.hops) || r.hops < 0 || r.hops > MAX_HOPS) return refuse("REQUEST_TOO_MANY_HOPS", `a request may pass through at most ${MAX_HOPS} agents`);
  if (r.hops === 0 && r.viaAgent) return refuse("REQUEST_HOPS_INVALID", "a request through an agent has passed at least one");
  if (typeof r.text !== "string" || !r.text.trim() || r.text.length > MAX_REQUEST_CHARS) return refuse("REQUEST_TEXT_INVALID", `a request is 1 to ${MAX_REQUEST_CHARS} characters`);
  const opened = await deps.openChat();
  if (!opened.ok) return refuse("REQUEST_CHAT_UNAVAILABLE", opened.code);
  const requestId = crypto.randomUUID();
  // The attachments ride in the request's words, so they are read by its turn alone, under its readers.
  let text = r.text;
  if (r.attachments !== undefined) {
    const kept = deps.attach ? deps.attach({ from: r.from, origin: r.origin, requestId, chatId: opened.chatId, refs: r.attachments }) : { ok: false as const, code: "ATTACHMENTS_UNAVAILABLE", reason: "this agent takes no attachments" };
    if (!kept.ok) return refuse(kept.code, kept.reason);
    text = [r.text, ...kept.lines].join("\n\n");
  }
  const { attachments: _refs, ...plain } = r;
  const ran = await deps.run(opened.chatId, { ...plain, text, requestId });
  if ("code" in ran) return { ok: false, code: ran.code, reason: "the request could not run" };
  return { ok: true, requestId, status: ran.status, text: ran.text };
}
