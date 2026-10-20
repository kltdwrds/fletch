// Secrets typed in chat (M14.2, Q24). Before a person's message is stored, the values in it that are
// plainly credentials are held in the `Vault` as `typed` credentials, used once, and the message keeps
// `[credential:cred://typed-<id>]` in their place: the transcript, the model, logs and memory see only
// the reference. Pure: finding the values and rewriting the text; the holding is the caller's.

/** How long a typed secret waits to be used once: a day, then it expires unused. */
export const TYPED_TTL_MS = 24 * 3_600_000;
/** How long the one-shot fill grant an allow-once card mints lasts: the action runs at once. */
export const CARD_GRANT_MS = 5 * 60_000;

/** Values that are credentials by their shape: vendor key prefixes, private keys and JWTs. */
const SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b[sr]k_live_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

/** A value the person labels as one: "my password is X", "pin: X", "api key = X". */
const LABELED = /\b(password|passcode|passphrase|pin|pin code|api[ _-]?key|access token|token|secret)\b(?:\s+(?:is|was))?\s*[:=]?\s+["'“]?([^\s"'”]{4,200})/gi;

export interface Found {
  start: number;
  end: number;
}

/** Every credential-shaped or labeled value in the text, in order, without overlaps. */
export function findTypedSecrets(text: string): Found[] {
  const spans: Found[] = [];
  for (const re of SHAPES) for (const m of text.matchAll(re)) spans.push({ start: m.index, end: m.index + m[0].length });
  for (const m of text.matchAll(LABELED)) {
    const raw = m[2] as string;
    const value = raw.replace(/[.,;!?)]+$/, "");
    // A reference already in the text, or a plain word after "token", is not a value.
    if (value.length < 4 || value.startsWith("[credential:") || value.startsWith("cred://") || !/[0-9]|[^A-Za-z]/.test(value)) continue;
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
