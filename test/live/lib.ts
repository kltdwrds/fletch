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
