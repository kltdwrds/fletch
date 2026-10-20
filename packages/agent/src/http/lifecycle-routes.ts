// The app's routes for learning and lifecycle (M11.2): the promotion queue, memory import, offboarding
// and onboarding. Every one is the signed-in person acting in person (an `Actor` of kind person), and
// the store that owns the data decides: the `Company` holds the queue and onboarding and checks roles,
// the person's `Person` holds import and offboarding and admits only its own person. Nothing in a
// request names who acts. The dispatcher's platform calls for a conversion are `platformLifecycle`.
import type { Actor } from "../learning/ladder.ts";

// The conversion's platform paths, as the dispatcher's provisioning module named them (the dispatcher is not part of fletch).
const CONVERSION_BUNDLE_PATH = "/_platform/conversion/bundle";
const CONVERSION_COMPLETE_PATH = "/_platform/conversion/complete";
const RESTORE_PATH = "/_platform/restore";

type Answer = Promise<unknown>;

export interface LifecycleDirectory {
  promotions(email: string): Answer;
  promotionAct(action: "consent" | "merge" | "decline", actor: Actor, id: string): Answer;
  importPlan(person: string, actor: Actor, summary: string): Answer;
  importConfirm(person: string, actor: Actor, id: string): Answer;
  offboardStatus(person: string): Answer;
  offboardStart(person: string, actor: Actor): Answer;
  offboardFinish(person: string, actor: Actor, choice: unknown): Answer;
  onboardingStatus(by: string): Answer;
  onboardingSkip(actor: Actor, step: unknown): Answer;
  onboardingStudy(actor: Actor, material: unknown): Answer;
  onboardingReview(actor: Actor, input: { accept?: unknown; reject?: unknown }): Answer;
  /** The dispatcher's calls for a conversion (M11.2), reached only with the platform flag. */
  conversionBundle(person: string, request: unknown): Answer;
  conversionComplete(person: string, input: { request?: unknown; ok?: unknown; code?: unknown }): Answer;
  conversionRestore(person: string, markdown: unknown): Answer;
  /** Staging only: the person's own memory search, for the live lane. */
  memorySearch?(person: string, queries: string[]): Answer;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A refusal's status from its code: who may not, what is not there, or a conflict with the state. */
export function statusOf(r: unknown): number {
  const v = r as { ok?: unknown; code?: unknown } | null;
  if (v?.ok !== false) return 200;
  const code = String(v.code ?? "");
  if (/NOT_AN_ADMIN|_ONLY$|NOT_OWNER|NOT_PRINCIPAL|NOT_A_MEMBER|NOT_PROPOSER|NOT_KEY_HOLDER|NOT_IN_TEAM|_FORBIDDEN$/.test(code)) return 403;
  if (/NOT_FOUND|UNKNOWN/.test(code)) return 404;
  if (/INVALID|MALFORMED/.test(code)) return 400;
  return 409;
}

const answer = (r: unknown) => json(r, statusOf(r));
const body = async (request: Request) => ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function lifecycleRoutes(request: Request, url: URL, person: string, env: Pick<Env, "QYVR_ENV">, dir: LifecycleDirectory | undefined): Promise<Response | null> {
  if (!dir) return null;
  const me: Actor = { kind: "person", email: person };
  const get = request.method === "GET";
  const post = request.method === "POST";
  const p = url.pathname;

  if (p === "/promotions" && get) return json({ proposals: await dir.promotions(person) });
  const promo = p.match(/^\/promotions\/([^/]+)\/(consent|merge|decline)$/);
  if (promo && post) return ID.test(promo[1] as string) ? answer(await dir.promotionAct(promo[2] as "consent" | "merge" | "decline", me, promo[1] as string)) : json({ code: "PROMOTION_NOT_FOUND" }, 404);

  if (p === "/import" && post) {
    const b = await body(request);
    return typeof b.summary === "string" ? answer(await dir.importPlan(person, me, b.summary)) : json({ code: "IMPORT_SUMMARY_INVALID", reason: "summary is the text to import" }, 400);
  }
  const confirm = p.match(/^\/import\/([^/]+)\/confirm$/);
  if (confirm && post) return ID.test(confirm[1] as string) ? answer(await dir.importConfirm(person, me, confirm[1] as string)) : json({ code: "IMPORT_NOT_FOUND" }, 404);

  if (p === "/offboarding" && get) return json(await dir.offboardStatus(person));
  if (p === "/offboarding/start" && post) return answer(await dir.offboardStart(person, me));
  if (p === "/offboarding/finish" && post) return answer(await dir.offboardFinish(person, me, (await body(request)).choice));

  if (p === "/onboarding" && get) return answer(await dir.onboardingStatus(person));
  if (p === "/onboarding/skip" && post) return answer(await dir.onboardingSkip(me, (await body(request)).step));
  if (p === "/onboarding/study" && post) return answer(await dir.onboardingStudy(me, (await body(request)).material ?? ""));
  if (p === "/onboarding/review" && post) {
    const b = await body(request);
    return answer(await dir.onboardingReview(me, { accept: b.accept, reject: b.reject }));
  }

  if (p === "/dev/memory/search" && post) {
    if (env.QYVR_ENV !== "staging" || !dir.memorySearch) return json({ code: "NOT_FOUND" }, 404);
    const q = (await body(request)).queries;
    return json(await dir.memorySearch(person, Array.isArray(q) ? q.map(String).slice(0, 5) : []));
  }
  return null;
}

/**
 * The dispatcher's own calls into this tenant for a conversion: the departing person's bundle and the
 * completion in the tenant they leave, the restore in their new standalone tenant. The person is the
 * one the platform's request names, and must be a member here.
 */
export async function platformLifecycle(request: Request, url: URL, dir: { lifecycle?: LifecycleDirectory; isMember(email: string): Promise<boolean> }): Promise<Response | null> {
  const path = url.pathname;
  if (request.method !== "POST" || ![CONVERSION_BUNDLE_PATH, CONVERSION_COMPLETE_PATH, RESTORE_PATH].includes(path)) return null;
  if (!dir.lifecycle) return json({ code: "NOT_FOUND" }, 404);
  const b = await body(request);
  const person = typeof b.person === "string" ? b.person : "";
  if (!person || !(await dir.isMember(person))) return json({ ok: false, code: "NOT_A_MEMBER", reason: "the request's person is not a member here" }, 403);
  if (path === CONVERSION_BUNDLE_PATH) return answer(await dir.lifecycle.conversionBundle(person, b.request));
  if (path === CONVERSION_COMPLETE_PATH) return answer(await dir.lifecycle.conversionComplete(person, { request: b.request, ok: b.ok, code: b.code }));
  return answer(await dir.lifecycle.conversionRestore(person, b.markdown));
}
