// What the person reads when a decision on an approval card was not taken (M20.1, QYVR-174): words,
// never the code. The code stays in the decide answer for programs; the chat page and the Approvals
// page draw only this text. Every code the decide route can answer has its sentence here, and a test
// walks them all; one this table does not know still gets a sentence, never the code.

const NOTHING_RAN = "Nothing ran.";
const GRANT_NOT_MADE = `Not decided: your approval could not be recorded as a grant, so ${NOTHING_RAN.toLowerCase()} Tell an admin if it keeps happening.`;

export const DECIDE_WORDS: Record<string, string> = {
  // The decide route.
  DECISION_INVALID: "Not decided: the page did not say which card or which choice. Reload the page and choose again.",
  CHAT_NOT_FOUND: "Not decided: this card's chat could not be found for you.",
  NO_SESSION: "Not decided: you are signed out. Sign in again and choose again.",
  TENANT_MISMATCH: "Not decided: this sign-in belongs to another company.",
  // The chat's approvals.
  CARD_UNKNOWN: "Not decided: this chat holds no such card; it may have been shown somewhere else.",
  APPROVAL_AGENT_REFUSED: `Not decided: an agent never decides its own approvals. ${NOTHING_RAN}`,
  APPROVAL_NOT_PRINCIPAL: `Not decided: only the person this card asks can decide it. ${NOTHING_RAN}`,
  APPROVAL_NOT_APPROVER: `Not decided: this card touches a company resource, so only an admin can decide it. ${NOTHING_RAN}`,
  CHOICE_INVALID: "Not decided: that choice is not one this card offers. Choose one of its buttons.",
  PURCHASE_NOT_LASTING: "Not decided: a purchase can only be allowed once or declined, never for longer.",
  SHARE_NOT_LASTING: "Not decided: a public share link can only be allowed once, on its own card, or declined; never for longer.",
  GRANTS_UNAVAILABLE: `Not decided: your grants could not be reached just now. ${NOTHING_RAN} Try again in a moment.`,
  // Making the approval's grant (`grants/validate.ts`, the person's and the company's stores).
  NOT_AN_ADMIN: `Not decided: only an admin can sign a company grant. ${NOTHING_RAN}`,
  GRANT_NOT_YOURS: `Not decided: only the person whose grant it is can sign it. ${NOTHING_RAN}`,
  GRANT_INVALID: GRANT_NOT_MADE,
  GRANT_GRANTEE_INVALID: GRANT_NOT_MADE,
  GRANT_GRANTOR_INVALID: GRANT_NOT_MADE,
  GRANT_SUBJECT_INVALID: GRANT_NOT_MADE,
  GRANT_MODE_INVALID: GRANT_NOT_MADE,
  GRANT_SOURCE_INVALID: GRANT_NOT_MADE,
  GRANT_CONSTRAINT_INVALID: GRANT_NOT_MADE,
  GRANT_EXPIRY_INVALID: GRANT_NOT_MADE,
  GRANT_PURCHASE_LASTING: "Not decided: a purchase can only be allowed once or declined, never for longer.",
  GRANT_SHARE_LASTING: "Not decided: a public share link can only be allowed once, on its own card, or declined; never for longer.",
};

/** The sentence for a decision that was not taken; an unknown code a general one, never the code. */
export function decideText(code: string): string {
  return DECIDE_WORDS[code] ?? "Not decided: something went wrong recording your decision. Reload the page to see the card as it stands.";
}
