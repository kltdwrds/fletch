// The egress module (AD-12): the only code path that turns a `cred://` reference into a header
// value. It runs inside the `Vault` object, so a resolved value never leaves that isolate except in
// the request to the listed host it was bound to. Each resolution writes an audit row (reference,
// host, method, path, person, purpose, outcome; never the value). Redirects are not followed, so a
// credential cannot ride a redirect to another host, and any echo of a secret in the response is
// redacted before the result goes back to the caller, and so is any surrogate token (M25.1). A value
// stands where its credential's declaration placed it: a header, a query parameter or a body field.
import { type EgressCode, type EgressFailure, type HostRule, type OutboundRequest, plan, planFill, type PublicHost, redact } from "./policy.ts";
import { scrubSurrogates } from "./surrogate.ts";

/** Who asked and why: the person the request acts for and the tool or job that made it. */
export interface EgressContext {
  person: string;
  purpose: string;
}

/** `scope` is set when a company connector's credential was used: what it read is company scope (M10.2). */
export type EgressResult = { ok: true; status: number; headers: Array<[string, string]>; body: string; scope?: { kind: "company"; connector: string } } | EgressFailure;

/** A resolution: the value and, when a credential grant covered it, that grant's nonce for the audit row. */
export type Revealed = { ok: true; value: string; grant?: string } | { ok: false; code: EgressCode; reason: string };

export interface AuditRow {
  at: number;
  ref: string;
  host: string;
  method: string;
  path: string;
  person: string;
  purpose: string;
  outcome: "resolved" | EgressCode;
  /** The credential grant that covered the resolution (M13), by nonce. */
  grant?: string;
}

export interface EgressDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Resolves a reference for a host and a method (`FILL` for a fill); only the Vault implements this. */
  reveal: (ref: string, host: string, method: string) => Promise<Revealed>;
  audit: (row: AuditRow) => void;
  now: () => number;
  /** The host rules for this person: the public hosts and the tenant registry's entries. */
  hosts: readonly HostRule[];
  /** Hosts a credential-free GET or HEAD may reach beyond `hosts` (M25.6): set for a job's reads alone. */
  publicHost?: PublicHost;
}

/** Response bodies above this are refused rather than cut, so a partial read is never shown as whole. */
export const RESPONSE_MAX = 1_000_000;
/** Response headers passed back; the rest (cookies among them) stay at egress. */
const PASSED_HEADERS = new Set(["content-type", "etag", "last-modified", "link", "location", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"]);

export async function egressFetch(deps: EgressDeps, req: OutboundRequest, ctx: EgressContext): Promise<EgressResult> {
  const planned = plan(req, deps.hosts, deps.publicHost);
  if (!planned.ok) return planned;
  const { url, method, uses } = planned;
  const host = url.hostname;
  const row = (ref: string, outcome: AuditRow["outcome"], grant?: string) =>
    deps.audit({ at: deps.now(), ref, host, method, path: url.pathname, person: ctx.person, purpose: ctx.purpose, outcome, ...(grant ? { grant } : {}) });

  const headers = new Headers(planned.headers);
  const target = new URL(url.href);
  let fields: Record<string, unknown> | undefined;
  const secrets: Array<{ ref: string; value: string }> = [];
  for (const use of uses) {
    const revealed = await deps.reveal(use.ref, host, method);
    row(use.ref, revealed.ok ? "resolved" : revealed.code, revealed.ok ? revealed.grant : undefined);
    if (!revealed.ok) return { ok: false, code: revealed.code, reason: revealed.reason, host };
    secrets.push({ ref: use.ref, value: revealed.value });
    const p = use.placement;
    if (p.in === "header") headers.set(p.name, `${p.prefix}${revealed.value}`);
    else if (p.in === "query") target.searchParams.set(p.param, revealed.value);
    else {
      // The policy parsed this body as a JSON object to find the field.
      fields ??= JSON.parse(planned.body as string) as Record<string, unknown>;
      fields[p.field] = revealed.value;
    }
  }
  const body = fields ? JSON.stringify(fields) : planned.body;
  // What goes back to the caller: the value redacted to its reference, and any surrogate to a marker.
  const clean = (text: string) => scrubSurrogates(redact(text, secrets));

  let response: Response;
  try {
    response = await deps.fetch(target.href, { method, headers, redirect: "manual", ...(body !== undefined ? { body } : {}) });
  } catch (err) {
    return { ok: false, code: "EGRESS_UPSTREAM_FAILED", reason: clean(String(err instanceof Error ? err.message : err)), host };
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > RESPONSE_MAX) return { ok: false, code: "EGRESS_RESPONSE_TOO_LARGE", reason: `${length} bytes; the limit is ${RESPONSE_MAX}`, host };
  let answer: string;
  try {
    answer = method === "HEAD" ? "" : await response.text();
  } catch (err) {
    return { ok: false, code: "EGRESS_UPSTREAM_FAILED", reason: clean(`the response body could not be read: ${String(err instanceof Error ? err.message : err)}`), host };
  }
  if (answer.length > RESPONSE_MAX) return { ok: false, code: "EGRESS_RESPONSE_TOO_LARGE", reason: `${answer.length} characters; the limit is ${RESPONSE_MAX}`, host };
  const passed: Array<[string, string]> = [];
  response.headers.forEach((value, name) => {
    if (PASSED_HEADERS.has(name.toLowerCase())) passed.push([name, clean(value)]);
  });
  return { ok: true, status: response.status, headers: passed, body: clean(answer) };
}

export interface FillDeps {
  reveal: (ref: string, host: string, method: string) => Promise<Revealed>;
  audit: (row: AuditRow) => void;
  now: () => number;
  hosts: readonly HostRule[];
  /** Types the value into the page; runs inside the Vault's isolate and is the only thing that sees it. */
  inject: (value: string) => Promise<void>;
}

export type FillResult = { ok: true; host: string } | EgressFailure;

/**
 * Credential fill (M9): the one path by which a value reaches a browser page. The host must list the
 * reference for fill, the resolution writes an audit row (method FILL, never the value), and the
 * caller gets only an outcome: a failure's reason is redacted of the value before it leaves.
 */
export async function egressFill(deps: FillDeps, req: { url: string; ref: string }, ctx: EgressContext): Promise<FillResult> {
  const planned = planFill(req, deps.hosts);
  if (!planned.ok) return planned;
  const { host, url } = planned;
  const row = (outcome: AuditRow["outcome"], grant?: string) =>
    deps.audit({ at: deps.now(), ref: req.ref, host, method: "FILL", path: url.pathname, person: ctx.person, purpose: ctx.purpose, outcome, ...(grant ? { grant } : {}) });
  const revealed = await deps.reveal(req.ref, host, "FILL");
  if (!revealed.ok) {
    row(revealed.code);
    return { ok: false, code: revealed.code, reason: revealed.reason, host };
  }
  try {
    await deps.inject(revealed.value);
  } catch (err) {
    row("EGRESS_FILL_FAILED");
    return { ok: false, code: "EGRESS_FILL_FAILED", reason: redact(String(err instanceof Error ? err.message : err), [{ ref: req.ref, value: revealed.value }]), host };
  }
  row("resolved", revealed.grant);
  return { ok: true, host };
}
