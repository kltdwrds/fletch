// What a service said no with (M9, B13): a bot wall, a rate limit or a refusal. Code decides this from
// the status and the text, never the model; the verdict stops the scope the block applies to.

export type BlockKind = "bot_wall" | "rate_limited" | "access_denied";
export interface Block {
  kind: BlockKind;
  code: "BROWSE_BOT_WALL" | "BROWSE_RATE_LIMITED" | "BROWSE_ACCESS_DENIED";
  reason: string;
  /** Seconds the service asked to wait, when it said. */
  retryAfter?: number;
}

const CHALLENGE =
  /just a moment\.\.\.|checking your browser|verify you are (?:a )?human|verifying you are human|enable javascript and cookies to continue|attention required|are you (?:a )?robot|unusual traffic|captcha|access denied|request blocked/i;
/** A real article may mention a captcha; a challenge page is short. */
const CHALLENGE_PAGE_MAX = 4000;

export function classify(status: number, text: string, retryAfter?: string | null): Block | null {
  if (status === 429) {
    const wait = Number(retryAfter);
    return { kind: "rate_limited", code: "BROWSE_RATE_LIMITED", reason: "the site is rate limiting this browser", ...(Number.isFinite(wait) && wait > 0 ? { retryAfter: wait } : {}) };
  }
  const challenge = CHALLENGE.test(text) && (text.length < CHALLENGE_PAGE_MAX || status >= 400);
  if (challenge) return { kind: "bot_wall", code: "BROWSE_BOT_WALL", reason: "the site put a bot check in front of the page" };
  if (status === 401 || status === 403) return { kind: "access_denied", code: "BROWSE_ACCESS_DENIED", reason: `the site refused access (${status})` };
  return null;
}
