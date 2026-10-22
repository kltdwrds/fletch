// The sweep: lists what a throwaway account holds, keeps only `fletch-ci-` names (lib.ts) and deletes them. It
// takes the API as a parameter, so a hermetic test answers every call. A bucket the API refuses to delete is
// reported by name as a leak: R2's REST API cannot list or empty a bucket's objects (that needs S3 credentials),
// and the agent does write R2 objects (MEMORY.md and the other home files), so the bucket of a run is usually not
// empty. The manual delete: Dashboard, R2, the bucket, delete its objects, then delete the bucket. `triageLeaks`
// (lib.ts) tells the live test which leak is its own expected bucket and which fails the run.
import { type CleanupStep, type Leak, type Listing, planSweep, stepAllowed } from "./lib.ts";

export interface Api {
  call<T = unknown>(method: string, path: string): Promise<T>;
}

const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;

// Pagination: nothing in the provisioning code this was copied from documents a cursor for the R2 bucket list, so it
// reads the first page only (Cloudflare's default is 20 buckets; docs/runbooks/live-deploy.md notes it).
export async function listAccount(api: Api, accountId: string): Promise<Listing> {
  const base = `/accounts/${accountId}`;
  const workers = await api.call<{ id: string }[]>("GET", `${base}/workers/scripts`);
  const buckets = await api.call<{ buckets?: { name: string }[] }>("GET", `${base}/r2/buckets`);
  const indexes = await api.call<{ name: string }[]>("GET", `${base}/vectorize/v2/indexes`);
  return { workers: (workers ?? []).map((w) => w.id), buckets: (buckets?.buckets ?? []).map((b) => b.name), indexes: (indexes ?? []).map((i) => i.name) };
}

export interface Outcome {
  deleted: string[];
  gone: string[];
  /** Each leak's line, as printed. */
  leaked: string[];
  /** The same leaks with what refused them, for `triageLeaks`. */
  leaks: Leak[];
}

/** Runs the steps in order. The guard is checked again right before each DELETE; a step that fails it is never sent. */
export async function runSteps(api: Api, steps: CleanupStep[], log: (line: string) => void, scrub: (text: string) => string = (t) => t): Promise<Outcome> {
  const out: Outcome = { deleted: [], gone: [], leaked: [], leaks: [] };
  const leak = (l: Leak) => {
    out.leaks.push(l);
    out.leaked.push(l.line);
  };
  for (const step of steps) {
    const label = `${step.kind} ${step.name}`;
    if (!stepAllowed(step)) {
      leak({ kind: step.kind, name: step.name, line: `${label}: refused by the fletch-ci- guard, not deleted` });
      continue;
    }
    try {
      await api.call(step.method, step.path);
      out.deleted.push(label);
      log(`cleanup: deleted ${label}`);
    } catch (error) {
      if (statusOf(error) === 404) {
        out.gone.push(label);
        log(`cleanup: ${label} was not there`);
      } else {
        const hint = step.kind === "bucket" ? " (a bucket with objects cannot be deleted through the API: Dashboard, R2, the bucket, delete its objects, then delete the bucket)" : "";
        const status = statusOf(error);
        leak({ kind: step.kind, name: step.name, ...(status !== undefined ? { status } : {}), line: `${label}: ${scrub((error as Error).message)}${hint}` });
      }
    }
  }
  return out;
}

/** List the account, plan the `fletch-ci-` deletes, run them. */
export async function sweep(api: Api, accountId: string, log: (line: string) => void, scrub?: (text: string) => string): Promise<Outcome> {
  const steps = planSweep(accountId, await listAccount(api, accountId));
  log(`sweep: ${steps.length} fletch-ci- resource(s) to delete`);
  return runSteps(api, steps, log, scrub);
}
