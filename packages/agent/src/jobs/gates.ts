// Gates (AD-3, M5.1): deterministic code that decides, in the alarm and with no model call, whether
// a tick has anything to do. A closed gate creates no run row and calls no model; that is the whole
// of the cost design (muse-reference section 6: 81 % of the source's cron runs found nothing).
// Each gate takes an injected clock and reaches the network only through the egress module.
import type { EgressResult } from "../egress/module.ts";
import { inWindow, type Window } from "./schedule.ts";

export type Gate =
  /** Open only while inside a window in the job's zone. */
  | { kind: "window"; window: Window }
  /** Open when a page's ETag or the sha256 of its body changes; the first read sets the baseline. */
  | { kind: "url"; url: string }
  /** Open when a number read from a JSON document (at a JSON pointer) rises above the last seen. */
  | { kind: "watermark"; url: string; pointer?: string }
  /** Open when a number crosses into the condition; it stays closed while the condition holds. */
  | { kind: "threshold"; url: string; pointer?: string; above?: number; below?: number }
  /** Open on an event from the owner's `Ingress` source (M6.1), when the value at `pointer` equals `equals`. */
  | { kind: "event"; source: string; pointer?: string; equals?: string | number | boolean };

export interface GateState {
  /** The watermark a certified silence wrote (M25.2): where the job's last run read up to. */
  mark?: string;
  etag?: string;
  hash?: string;
  watermark?: number;
  inside?: boolean;
}

/** What an open gate saw, which the run's steps read; page text is data, fenced where it is shown. */
export interface Observation {
  url?: string;
  /** For an event gate: the `Ingress` source and the event id. */
  source?: string;
  event?: string;
  status?: number;
  excerpt?: string;
  before?: string | number;
  after?: string | number;
}

export type GateResult =
  | { open: true; state: GateState; observed: Observation }
  | { open: false; state: GateState; why: "unchanged" | "baseline" | "outside_window" | "below_watermark" | "condition_held" | "condition_false" | "event_only" }
  /** `blocked` is a refusal by the service (a rate limit, a bot wall): stop and say so, never route around it (B13). */
  | { open: false; error: { code: string; reason: string; blocked: boolean } };

export interface GateDeps {
  now: () => number;
  zone: string;
  /** GET through the egress module, the person and the job's purpose already bound. */
  get: (url: string, headers: Array<[string, string]>) => Promise<EgressResult>;
}

export type GateCode = "GATE_FETCH_REFUSED" | "GATE_HTTP_ERROR" | "GATE_RATE_LIMITED" | "GATE_BLOCKED_BY_SERVICE" | "GATE_NOT_A_NUMBER" | "GATE_BAD_JSON";

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const EXCERPT = 600;

function failure(r: EgressResult): { code: GateCode; reason: string; blocked: boolean } | null {
  if (!r.ok) return { code: "GATE_FETCH_REFUSED", reason: `${r.code}: ${r.reason}`, blocked: false };
  if (r.status === 429) return { code: "GATE_RATE_LIMITED", reason: "the service answered 429", blocked: true };
  if (r.status === 403) return { code: "GATE_BLOCKED_BY_SERVICE", reason: "the service answered 403", blocked: true };
  if (r.status === 304) return null;
  if (r.status < 200 || r.status > 299) return { code: "GATE_HTTP_ERROR", reason: `the service answered ${r.status}`, blocked: false };
  return null;
}

/** Reads a number at a JSON pointer (RFC 6901); the empty pointer is the whole document. */
export function numberAt(body: string, pointer = ""): { ok: true; value: number } | { ok: false; code: GateCode; reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false, code: "GATE_BAD_JSON", reason: "the answer was not JSON" };
  }
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    doc = doc !== null && typeof doc === "object" ? (doc as Record<string, unknown>)[key] : undefined;
  }
  return typeof doc === "number" && Number.isFinite(doc) ? { ok: true, value: doc } : { ok: false, code: "GATE_NOT_A_NUMBER", reason: `no number at "${pointer}"` };
}

export async function evaluateGate(gate: Gate, state: GateState, deps: GateDeps): Promise<GateResult> {
  switch (gate.kind) {
    case "event":
      // An event gate opens only on an event (`jobs/events.ts`); a scheduled tick never opens it.
      return { open: false, state, why: "event_only" };
    case "window": {
      const inside = inWindow(deps.now(), gate.window, deps.zone);
      return inside ? { open: true, state, observed: {} } : { open: false, state, why: "outside_window" };
    }
    case "url": {
      const r = await deps.get(gate.url, state.etag ? [["if-none-match", state.etag]] : []);
      const err = failure(r);
      if (err) return { open: false, error: err };
      if (!r.ok || r.status === 304) return { open: false, state, why: "unchanged" };
      const etag = r.headers.find(([k]) => k.toLowerCase() === "etag")?.[1];
      const hash = await sha256(r.body);
      const next: GateState = { ...state, hash, ...(etag ? { etag } : {}) };
      if (state.hash === undefined) return { open: false, state: next, why: "baseline" };
      if (state.hash === hash) return { open: false, state: next, why: "unchanged" };
      return { open: true, state: next, observed: { url: gate.url, status: r.status, excerpt: r.body.slice(0, EXCERPT), before: state.hash, after: hash } };
    }
    case "watermark":
    case "threshold": {
      const r = await deps.get(gate.url, [["accept", "application/json"]]);
      const err = failure(r);
      if (err) return { open: false, error: err };
      if (!r.ok) return { open: false, state, why: "unchanged" };
      const n = numberAt(r.body, gate.pointer);
      if (!n.ok) return { open: false, error: { code: n.code, reason: n.reason, blocked: false } };
      if (gate.kind === "watermark") {
        const prior = state.watermark;
        const next = { ...state, watermark: Math.max(prior ?? n.value, n.value) };
        if (prior === undefined) return { open: false, state: next, why: "baseline" };
        return n.value > prior ? { open: true, state: next, observed: { url: gate.url, before: prior, after: n.value } } : { open: false, state: next, why: "below_watermark" };
      }
      const holds = (gate.above === undefined || n.value > gate.above) && (gate.below === undefined || n.value < gate.below);
      const next = { ...state, inside: holds };
      if (!holds) return { open: false, state: next, why: "condition_false" };
      if (state.inside === true) return { open: false, state: next, why: "condition_held" };
      return { open: true, state: next, observed: { url: gate.url, after: n.value } };
    }
  }
}
