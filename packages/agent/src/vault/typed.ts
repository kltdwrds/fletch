// Secrets typed in chat (M14.2, Q24). Before a person's message is stored, the values in it that are
// plainly credentials are held in the `Vault` as `typed` credentials, used once, and the message keeps
// `[credential:cred://typed-<id>]` in their place: the transcript, the model, logs and memory see only
// the reference. Pure: finding the values and rewriting the text; the holding is the caller's.

/** How long a typed secret waits to be used once: a day, then it expires unused. */
export const TYPED_TTL_MS = 24 * 3_600_000;
/** How long the one-shot fill grant an allow-once card mints lasts: the action runs at once. */
export const CARD_GRANT_MS = 5 * 60_000;

/** Whether a run of digits passes the Luhn check, as every payment card number does (P12 delta 1). */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** A card number: 13 to 19 digits, spaces or dashes between them allowed, held only when it passes Luhn (P12 delta 1). */
export const CARD_NUMBER = { re: /\b\d(?:[ -]?\d){12,18}\b/g, valid: (m: string) => luhn(m.replace(/[ -]/g, "")) };

/** Values that are credentials by their shape: vendor key prefixes, private keys, JWTs and card numbers. */
export const SHAPES: ReadonlyArray<RegExp | { re: RegExp; valid: (m: string) => boolean }> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  CARD_NUMBER,
];

/** The words a person labels a secret with: "my password is X", "pin: X", "api key = X" (patterns, in match order). */
const LABELS = ["password", "passcode", "passphrase", "pin", "pin code", "api[ _-]?key", "access token", "token", "secret"];
/**
 * A card's words (P12 delta 1): "card number X", "cvc 123", "exp 12/30". A card word's value may be three characters,
 * as a security code is, and must hold a digit.
 */
export const CARD_LABELS: ReadonlySet<string> = new Set(["card number", "card", "cvc", "cvv", "security code", "expiry", "exp"]);
/** A value the person labels as one, built from the words above at each read. */
const labeled = () => new RegExp(`\\b(${[...LABELS, ...CARD_LABELS].join("|")})\\b(?:\\s+(?:is|was))?\\s*[:=]?\\s+["'“]?([^\\s"'”]{3,200})`, "gi");

export interface Found {
  start: number;
  end: number;
}

/** Every credential-shaped or labeled value in the text, in order, without overlaps. */
export function findTypedSecrets(text: string): Found[] {
  const spans: Found[] = [];
  for (const shape of SHAPES) {
    const { re, valid } = shape instanceof RegExp ? { re: shape, valid: () => true } : shape;
    for (const m of text.matchAll(re)) if (valid(m[0])) spans.push({ start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(labeled())) {
    const raw = m[2] as string;
    const value = raw.replace(/[.,;!?)]+$/, "");
    // A reference already in the text, or a plain word after "token", is not a value; a card word's value holds a digit.
    const card = CARD_LABELS.has((m[1] as string).toLowerCase());
    if (value.length < (card ? 3 : 4) || value.startsWith("[credential:") || value.startsWith("cred://") || !/[0-9]|[^A-Za-z]/.test(value) || (card && !/[0-9]/.test(value))) continue;
    const start = m.index + m[0].length - raw.length;
    spans.push({ start, end: start + value.length });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Found[] = [];
  for (const s of spans) if (!out.length || s.start >= (out.at(-1) as Found).end) out.push(s);
  return out;
}

export type HeldText = { ok: true; text: string; refs: string[] } | { ok: false; code: "SECRET_NOT_HELD" };

/**
 * The text with each found value replaced by the reference it is held under. If any value cannot be
 * held, nothing is stored: the message is refused rather than kept with the value in it.
 */
export async function holdTypedSecrets(text: string, hold: (value: string) => Promise<{ ok: true; ref: string } | { ok: false; code: string }>): Promise<HeldText> {
  const found = findTypedSecrets(text);
  if (!found.length) return { ok: true, text, refs: [] };
  let out = "";
  let at = 0;
  const refs: string[] = [];
  for (const f of found) {
    const r = await hold(text.slice(f.start, f.end)).catch((): { ok: false; code: string } => ({ ok: false, code: "VAULT_UNAVAILABLE" }));
    if (!r.ok) return { ok: false, code: "SECRET_NOT_HELD" };
    refs.push(r.ref);
    out += `${text.slice(at, f.start)}[credential:${r.ref}]`;
    at = f.end;
  }
  return { ok: true, text: out + text.slice(at), refs };
}
