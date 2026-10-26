// A name from a person's own words (F8, moved here at F12): a chat's from its first prompt, a task's from the words
// that began it. No model call: the list must name what it lists on the read path. `http/app/chats-list.ts`
// re-exports both, and its page script carries a copy that `test/workers/f8-new-chat.test.ts` holds to this one.

/** How many characters of the words name a chat or a task, before the cut and its ellipsis. */
export const TITLE_FROM_PROMPT = 60;

/**
 * The words on one line, trimmed, and past the cap cut at the last word that fits (or at the cap when none does)
 * with an ellipsis.
 */
export function promptTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= TITLE_FROM_PROMPT) return t;
  const cut = t.slice(0, TITLE_FROM_PROMPT);
  const at = cut.lastIndexOf(" ");
  return `${(at > TITLE_FROM_PROMPT / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
