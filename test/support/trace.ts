// The trace (parity framework design, Appendix B): one JSON document per scenario run, emitted by the tier-1
// runner (`defineScenario`, `runTask`) and written by hand from an interrogation (INTERROGATE.md). Every
// asserted field is a token (an id, a kind, a code, a key: no whitespace, at most TOKEN_MAX characters) or an
// enum value; prose lives only in `failure.user_words` and `examples[]`, which are never asserted. `validateTrace`
// refuses anything else by code and path, so a trace that reads like a story is caught where it is written.
export const TRACE_TAGS = ["instrumented", "attested", "captured"] as const;
export type TraceTag = (typeof TRACE_TAGS)[number];
export const ARMS = ["muse", "fletch"] as const;
export const ACTORS = ["user", "agent", "schedule", "event"] as const;
export const NOTIFICATIONS = ["none", "chat", "push"] as const;
export const FINALITIES = ["final", "retryable"] as const;
export const TIMINGS = ["immediate", "async_building", "scheduled", "event_driven"] as const;

export interface TraceStep {
  action: { kind: string; input_class: string; actor: (typeof ACTORS)[number] };
  observed: { surface: string; cards: string[]; text_class: string; notification: (typeof NOTIFICATIONS)[number] };
  /** Ids and kinds, never content: `run:r1`, `file:notes/a.md`. */
  state_delta: { records: string[]; files: string[]; jobs: string[]; reactions: string[]; other: string[] };
  failure: { code: string; user_words: string } | null;
  approval: { asked: boolean; scope: string; default: string; finality: (typeof FINALITIES)[number] } | null;
  timing: (typeof TIMINGS)[number];
  tags: TraceTag[];
}

export interface Trace {
  scenario_id: string;
  cluster: string;
  arm: (typeof ARMS)[number];
  /** ISO 8601. */
  run_at: string;
  source: { dump_version: string; preview_slot?: string };
  steps: TraceStep[];
  /** Model prose, never asserted. */
  examples: string[];
}

export type TraceReason = { code: "TRACE_NOT_OBJECT" | "TRACE_MISSING" | "TRACE_PROSE" | "TRACE_BAD_TAG" | "TRACE_BAD_ENUM" | "TRACE_BAD_TYPE"; path: string };
export type TraceVerdict = { ok: true } | { ok: false; reasons: TraceReason[] };

export const TOKEN_MAX = 80;
/** An id, a kind, a code or a key: no whitespace, no quotes, bounded. */
export const TOKEN = /^[A-Za-z0-9_][A-Za-z0-9_.:#/@+-]*$/;
export const isToken = (s: string) => s.length > 0 && s.length <= TOKEN_MAX && TOKEN.test(s);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Check {
  reasons: TraceReason[] = [];
  token(v: unknown, path: string) {
    if (typeof v !== "string") this.reasons.push({ code: "TRACE_BAD_TYPE", path });
    else if (!isToken(v)) this.reasons.push({ code: "TRACE_PROSE", path });
  }
  tokens(v: unknown, path: string) {
    if (!Array.isArray(v)) {
      this.reasons.push({ code: "TRACE_BAD_TYPE", path });
      return;
    }
    v.forEach((x, i) => {
      this.token(x, `${path}[${i}]`);
    });
  }
  prose(v: unknown, path: string) {
    if (typeof v !== "string") this.reasons.push({ code: "TRACE_BAD_TYPE", path });
  }
  enumOf(v: unknown, values: readonly string[], path: string) {
    if (typeof v !== "string" || !values.includes(v)) this.reasons.push({ code: "TRACE_BAD_ENUM", path });
  }
  /** The object at `path` with every key of `keys` present, or null after a reason. */
  shape(v: unknown, keys: string[], path: string): Record<string, unknown> | null {
    if (!isObject(v)) {
      this.reasons.push({ code: "TRACE_NOT_OBJECT", path });
      return null;
    }
    let ok = true;
    for (const k of keys) {
      if (!(k in v)) {
        this.reasons.push({ code: "TRACE_MISSING", path: path ? `${path}.${k}` : k });
        ok = false;
      }
    }
    return ok ? v : null;
  }
}

function checkStep(c: Check, s: unknown, path: string) {
  const step = c.shape(s, ["action", "observed", "state_delta", "failure", "approval", "timing", "tags"], path);
  if (!step) return;
  const action = c.shape(step.action, ["kind", "input_class", "actor"], `${path}.action`);
  if (action) {
    c.token(action.kind, `${path}.action.kind`);
    c.token(action.input_class, `${path}.action.input_class`);
    c.enumOf(action.actor, ACTORS, `${path}.action.actor`);
  }
  const observed = c.shape(step.observed, ["surface", "cards", "text_class", "notification"], `${path}.observed`);
  if (observed) {
    c.token(observed.surface, `${path}.observed.surface`);
    c.tokens(observed.cards, `${path}.observed.cards`);
    c.token(observed.text_class, `${path}.observed.text_class`);
    c.enumOf(observed.notification, NOTIFICATIONS, `${path}.observed.notification`);
  }
  const delta = c.shape(step.state_delta, ["records", "files", "jobs", "reactions", "other"], `${path}.state_delta`);
  if (delta) for (const k of ["records", "files", "jobs", "reactions", "other"]) c.tokens(delta[k], `${path}.state_delta.${k}`);
  if (step.failure !== null) {
    const failure = c.shape(step.failure, ["code", "user_words"], `${path}.failure`);
    if (failure) {
      c.token(failure.code, `${path}.failure.code`);
      c.prose(failure.user_words, `${path}.failure.user_words`);
    }
  }
  if (step.approval !== null) {
    const approval = c.shape(step.approval, ["asked", "scope", "default", "finality"], `${path}.approval`);
    if (approval) {
      if (typeof approval.asked !== "boolean") c.reasons.push({ code: "TRACE_BAD_TYPE", path: `${path}.approval.asked` });
      c.token(approval.scope, `${path}.approval.scope`);
      c.token(approval.default, `${path}.approval.default`);
      c.enumOf(approval.finality, FINALITIES, `${path}.approval.finality`);
    }
  }
  c.enumOf(step.timing, TIMINGS, `${path}.timing`);
  if (!Array.isArray(step.tags)) c.reasons.push({ code: "TRACE_BAD_TYPE", path: `${path}.tags` });
  else step.tags.forEach((t, i) => void ((TRACE_TAGS as readonly unknown[]).includes(t) || c.reasons.push({ code: "TRACE_BAD_TAG", path: `${path}.tags[${i}]` })));
}

/** The verdict on a document: `ok`, or every reason by code and path, in document order. */
export function validateTrace(doc: unknown): TraceVerdict {
  const c = new Check();
  const t = c.shape(doc, ["scenario_id", "cluster", "arm", "run_at", "source", "steps", "examples"], "");
  if (t) {
    c.token(t.scenario_id, "scenario_id");
    c.token(t.cluster, "cluster");
    c.enumOf(t.arm, ARMS, "arm");
    if (typeof t.run_at !== "string" || Number.isNaN(Date.parse(t.run_at))) c.reasons.push({ code: "TRACE_BAD_TYPE", path: "run_at" });
    const source = c.shape(t.source, ["dump_version"], "source");
    if (source) {
      c.token(source.dump_version, "source.dump_version");
      if ("preview_slot" in source) c.token(source.preview_slot, "source.preview_slot");
    }
    if (!Array.isArray(t.steps)) c.reasons.push({ code: "TRACE_BAD_TYPE", path: "steps" });
    else {
      t.steps.forEach((s, i) => {
        checkStep(c, s, `steps[${i}]`);
      });
    }
    if (!Array.isArray(t.examples)) c.reasons.push({ code: "TRACE_BAD_TYPE", path: "examples" });
    else {
      t.examples.forEach((e, i) => {
        c.prose(e, `examples[${i}]`);
      });
    }
  }
  return c.reasons.length ? { ok: false, reasons: c.reasons } : { ok: true };
}
