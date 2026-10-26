// A name from a person's own words (F8), shared by the chats list and the activity tasks (F12): no model call, so
// the list names a chat or a task on the read path.

/** How many characters of its first prompt name a chat (F8), before the cut and its ellipsis. */
export const TITLE_FROM_PROMPT = 60;

/**
 * A chat's name from its first prompt (F8): the prompt's own words on one line, trimmed, and past the cap cut at the
 * last word that fits (or at the cap when none does) with an ellipsis. The page script carries a copy (`CHATS_SCRIPT`),
 * which `test/workers/f8-new-chat.test.ts` holds to this one.
 */
export function promptTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= TITLE_FROM_PROMPT) return t;
  const cut = t.slice(0, TITLE_FROM_PROMPT);
  const at = cut.lastIndexOf(" ");
  return `${(at > TITLE_FROM_PROMPT / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
