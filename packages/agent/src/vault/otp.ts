// One-time codes in inbound mail (M13, muse-reference section 7): a code next to words that name it
// (code, passcode, verification, one-time, OTP, PIN, security code) is taken out of the text before
// the mail reaches a chat and kept in the `Vault` as a short-lived credential; the chat sees only
// `[credential:cred://otp-<id>]`. Pure: finding the codes and rewriting the text.

/** How long a captured code stays usable. */
export const OTP_TTL_MS = 10 * 60_000;
/** The one field a code may be typed into. */
export const OTP_FIELD = "verification_code";

const CUE = /\b(?:code|passcode|pass code|verification|verify|one[- ]time|otp|pin|security code|login code|sign[- ]in code|2fa|two[- ]factor)\b/i;
// Four to eight digits (a space or hyphen may split six or eight), or six to eight capitals and digits with at least one digit.
const TOKEN = /(?<![\w-])(?:\d{3}[ -]\d{3}|\d{4}[ -]\d{4}|\d{4,8}|(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})(?![\w-])/g;
/** Things shaped like a code that are not one: years and times. */
const NOT_A_CODE = /^(?:19|20)\d{2}$/;

export interface FoundCode {
  start: number;
  end: number;
  code: string;
}

/** Codes on lines that name a code; a line with no cue keeps its numbers. */
export function findOneTimeCodes(text: string): FoundCode[] {
  const out: FoundCode[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (CUE.test(line)) {
      for (const m of line.matchAll(TOKEN)) {
        const raw = m[0];
        if (NOT_A_CODE.test(raw)) continue;
        out.push({ start: offset + (m.index as number), end: offset + (m.index as number) + raw.length, code: raw.replace(/[ -]/g, "") });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

/** The text with each found code replaced by its marker; `refs[i]` names the i-th code, or null where it could not be kept. */
export function replaceCodes(text: string, found: readonly FoundCode[], refs: ReadonlyArray<string | null>): string {
  let out = "";
  let at = 0;
  found.forEach((f, i) => {
    const ref = refs[i];
    out += text.slice(at, f.start) + (ref ? `[credential:${ref}]` : "[one-time code withheld]");
    at = f.end;
  });
  return out + text.slice(at);
}
