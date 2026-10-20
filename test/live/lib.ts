// The pure helpers of the live exit test (F1): what names it may delete, the setup link init prints, and the
// plan for removing what a run created. Nothing here touches the network, so test/live/lib.test.ts runs in the
// hermetic lane and the live file stays a thin script over them.

/** Every Worker the live test deploys is named with this prefix; cleanup deletes nothing else. */
export const CI_PREFIX = "fletch-ci-";

/** The tenant name rule `init` enforces (`NAME` in create-fletch), restated so the guard stands on its own. */
const TENANT_NAME = /^[a-z][a-z0-9-]{1,30}$/;

/** The Worker name for a CI run: `fletch-ci-<run id>`, at most 31 characters, from the run id's last characters. */
export function workerNameFor(runId: string): string {
  const id = runId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-(31 - CI_PREFIX.length)).replace(/^-+/, "");
  return `${CI_PREFIX}${id || "local"}`;
}

/** Whether `name` is one this test may delete: the CI prefix, something after it, and a valid tenant name. */
export function isCiName(name: unknown): name is string {
  return typeof name === "string" && name.startsWith(CI_PREFIX) && name.length > CI_PREFIX.length && TENANT_NAME.test(name);
}

export type ResourceKind = "worker" | "bucket" | "index";

export interface CleanupStep {
  kind: ResourceKind;
  name: string;
  method: "DELETE";
  path: string;
}

export type CleanupPlan = { ok: true; steps: CleanupStep[] } | { ok: false; reason: string };

/**
 * The deletes for one run, in order: the Worker first (so nothing holds the bucket or the index), then the
 * bucket `<name>-agent` and the index `<name>-memory`. A name that does not start with `fletch-ci-` yields no
 * step at all, whatever the account holds; the guard is checked on the Worker and again on each derived name.
 */
export function planCleanup(accountId: string, name: string): CleanupPlan {
  if (!/^[0-9a-f]{32}$/.test(accountId)) return { ok: false, reason: "the account id is not 32 hexadecimal characters" };
  if (!isCiName(name)) return { ok: false, reason: `"${String(name)}" does not start with ${CI_PREFIX}; nothing will be deleted` };
  const bucket = `${name}-agent`;
  const index = `${name}-memory`;
  const base = `/accounts/${accountId}`;
  const steps: CleanupStep[] = [
    { kind: "worker", name, method: "DELETE", path: `${base}/workers/scripts/${name}?force=true` },
    { kind: "bucket", name: bucket, method: "DELETE", path: `${base}/r2/buckets/${bucket}` },
    { kind: "index", name: index, method: "DELETE", path: `${base}/vectorize/v2/indexes/${index}` },
  ];
  // Belt and braces: every step's own name is in the namespace, so a change to the derivation cannot widen the delete.
  if (!steps.every((s) => s.name.startsWith(name))) return { ok: false, reason: "a derived resource name left the fletch-ci- namespace" };
  return { ok: true, steps };
}

/** The setup link `init` logs: `<url>/login?setup=<token>`. */
export function parseSetupLink(output: string): { url: string; token: string; link: string } | null {
  const m = output.match(/(https:\/\/[^\s/?#]+)\/login\?setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return { url: m[1] as string, token: m[2] as string, link: m[0] };
}

/** A run id: GitHub's `GITHUB_RUN_ID` in CI, otherwise the clock in base 36 so two local runs differ. */
export function runIdFrom(env: Record<string, string | undefined>, now: number): string {
  return env.GITHUB_RUN_ID?.trim() || now.toString(36);
}

// --- what the run may print ------------------------------------------------------------------------

/** A recovery code's shape (four groups of five, dash-separated). Asserted instead of the code itself, so a failure prints nothing secret. */
export const isRecoveryShape = (code: unknown): boolean => typeof code === "string" && /^[A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){3}$/.test(code);

/** A setup token's shape (base64url, at least 32 characters). */
export const isSetupTokenShape = (token: unknown): boolean => typeof token === "string" && /^[A-Za-z0-9_-]{32,}$/.test(token);

/** The login page's `data-state` word, or null. A test compares this, never the page body. */
export function pageState(html: string): string | null {
  return html.match(/<body[^>]*\sdata-state="([a-z]+)"/)?.[1] ?? null;
}

/** GitHub Actions' mask command for `value`, or null outside Actions; printed as soon as a secret is known. */
export function maskCommand(value: string, env: Record<string, string | undefined>): string | null {
  return env.GITHUB_ACTIONS && value && !/[\r\n]/.test(value) ? `::add-mask::${value}` : null;
}

// --- the sweep -------------------------------------------------------------------------------------

/** What an account holds, by name. */
export interface Listing {
  workers: string[];
  buckets: string[];
  indexes: string[];
}

const SUFFIX: Record<ResourceKind, string> = { worker: "", bucket: "-agent", index: "-memory" };

/**
 * Whether a delete step may run: its name is `<fletch-ci- name><suffix for its kind>`, and its path ends with
 * exactly that name. Checked when a plan is made and again immediately before each DELETE.
 */
export function stepAllowed(step: CleanupStep): boolean {
  const suffix = SUFFIX[step.kind];
  if (suffix === undefined || step.method !== "DELETE" || typeof step.name !== "string") return false;
  if (suffix && !step.name.endsWith(suffix)) return false;
  const base = suffix ? step.name.slice(0, -suffix.length) : step.name;
  return isCiName(base) && step.path.split("?")[0]?.endsWith(`/${step.name}`) === true;
}

/** Deletes for every `fletch-ci-` Worker, `<name>-agent` bucket and `<name>-memory` index in `listing`; anything else is ignored. */
export function planSweep(accountId: string, listing: Listing): CleanupStep[] {
  if (!/^[0-9a-f]{32}$/.test(accountId)) return [];
  const base = `/accounts/${accountId}`;
  const steps: CleanupStep[] = [
    ...listing.workers.map((name): CleanupStep => ({ kind: "worker", name, method: "DELETE", path: `${base}/workers/scripts/${name}?force=true` })),
    ...listing.buckets.map((name): CleanupStep => ({ kind: "bucket", name, method: "DELETE", path: `${base}/r2/buckets/${name}` })),
    ...listing.indexes.map((name): CleanupStep => ({ kind: "index", name, method: "DELETE", path: `${base}/vectorize/v2/indexes/${name}` })),
  ];
  return steps.filter(stepAllowed);
}

/** One resource a cleanup could not delete: its kind and name, the API's status when it gave one, the printed line. */
export interface Leak {
  kind: ResourceKind;
  name: string;
  status?: number;
  line: string;
}

/** R2 refuses to delete a bucket that holds objects: 409, or the "not empty" words. */
const notEmpty = (l: Leak) => l.kind === "bucket" && (l.status === 409 || /not empty/i.test(l.line));

/**
 * Splits a live run's cleanup leaks. The run's own bucket `<name>-agent`, refused because it holds objects, is
 * expected: the teal step makes the agent write MEMORY.md there, and R2's API cannot empty a bucket. It is a manual
 * cleanup the run warns about by name. Any other leak (another run's bucket, a Worker, an index, this bucket refused
 * for another reason) fails the run. A leak seen twice (the run's own steps and then the sweep) is counted once.
 */
export function triageLeaks(leaks: Leak[], name: string): { expected: Leak[]; failures: Leak[] } {
  const own = `${name}-agent`;
  const expected: Leak[] = [];
  const failures: Leak[] = [];
  const seen = new Set<string>();
  for (const l of leaks) {
    const key = `${l.kind} ${l.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (l.name === own && notEmpty(l) ? expected : failures).push(l);
  }
  return { expected, failures };
}

/** The GitHub Actions warning (plain text elsewhere) for this run's own non-empty bucket: a cleanup left to do by hand. */
export const manualCleanupWarning = (bucket: string) =>
  `::warning::the bucket ${bucket} holds this run's objects (MEMORY.md from the teal step) and R2's API cannot empty it; delete it by hand before the next run (Dashboard, R2, ${bucket}, delete its objects, then delete the bucket), or that run's sweep fails on it`;
