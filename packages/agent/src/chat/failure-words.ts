// What the person reads when a turn fails (M17.1, QYVR-157): words, not the code. The code and the
// store's reason stay in the frame and the history entry for programs; the page draws only this text.
// A budget refusal says what ran out (the person's own daily allowance or the company's), when it
// resets (the start of the next UTC day) and who can raise it (an admin, on the admin page).

const RESETS = "It resets at midnight UTC, the start of the next UTC day.";
const ADMIN_RAISES = "An admin can raise it on the admin page, under Budgets.";

const WORDS: Record<string, string> = {
  BUDGET_PERSON_EXHAUSTED: `Your agent did not answer: your own daily allowance has run out. ${RESETS} ${ADMIN_RAISES}`,
  BUDGET_TENANT_EXHAUSTED: `Your agent did not answer: the company's daily allowance has run out, for everyone in it. ${RESETS} ${ADMIN_RAISES}`,
  BUDGET_STAGING_CAP: `Your agent did not answer: this test environment's daily spending cap is reached, for every company on it. ${RESETS} Only the platform's operator can raise it.`,
  BUDGET_UNAVAILABLE: "Your agent did not answer: the allowance could not be checked just now, so nothing was spent. Try again in a moment.",
  RUN_CEILING_REACHED: "Your agent stopped: this task reached its own spending ceiling.",
  AGENT_DISABLED: "Your agent did not answer: an admin has turned it off. An admin can turn it back on on the admin page, under Agents.",
  MODEL_TIER_REFUSED: "Your agent did not answer: its model is outside the company's model tier. An admin can change the tier on the admin page, under Budgets.",
  MODEL_UNPRICED: "Your agent did not answer: its model has no price on record, so its spending could not be counted against the daily allowance. Nothing was spent; tell an admin.",
  MODEL_RATE_LIMITED: "Your agent did not answer: the model is busy. Try again in a minute.",
  MODEL_FIRST_TOKEN_TIMEOUT: "Your agent did not answer: the model did not start replying in time, twice, so it was stopped. Try again in a moment.",
  MODEL_CALL_TIMEOUT: "Your agent stopped: the model's reply took too long to finish. Try again, or ask for a smaller piece.",
  TURN_STEP_LIMIT: "Your agent stopped: it took too many steps without finishing. Try asking for a smaller piece.",
  MEMORY_UNAVAILABLE: "Your agent did not answer: your memory could not be read just now. Try again in a moment.",
};

/** The sentence the page shows for a failed turn; every code has one, an unknown code a general one. */
export function failureText(code: string): string {
  return WORDS[code] ?? "Your agent could not finish this message. Try again; if it keeps happening, tell an admin.";
}
