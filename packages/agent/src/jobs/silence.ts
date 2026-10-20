// Certified silence (M25.2, AD-3): a job run ends with exactly one terminal tool, `report` or
// `nothing_to_report`, and silence is accepted only when code checks its list against what this run
// actually did. The model's checklist names; the run's own call log decides. Pure: no clock, no store.

/** The run's own record of each tool call it made, in order: what the checklist is checked against. */
export interface CallRecord {
  id: string;
  tool: string;
  ok: boolean;
  /** Set when the job refused the call itself (not a read tool): not a dependency of the work. */
  refused?: string;
  code?: string;
}

export interface SilenceClaim {
  /** What was checked, in a few words. */
  work: string;
  material_result: boolean;
  /** Tool call ids from this run (or "gate", for the observation the gate opened on) the conclusion rests on. */
  evidence: string[];
  dependencies: Array<{ tool: string; available: boolean; workaround: boolean }>;
  /** The point this run read up to (an item id, a date, a hash), written as the job's watermark. */
  watermark: string;
}

export type SilenceCode =
  | "SILENCE_NO_WORK"
  | "SILENCE_MATERIAL_RESULT"
  | "SILENCE_STALE_EVIDENCE"
  | "SILENCE_DEPENDENCY_UNAVAILABLE"
  | "SILENCE_WORKAROUND"
  | "SILENCE_NO_WATERMARK"
  | "SILENCE_CLAIM_INVALID";

export type SilenceVerdict = { ok: true; claim: SilenceClaim } | { ok: false; codes: Array<{ code: SilenceCode; reason: string }> };

const MAX_WATERMARK = 256;

/** Reads the terminal call's arguments into a claim; anything malformed is one code. */
export function parseClaim(args: unknown): SilenceClaim | null {
  const a = args as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  const deps = Array.isArray(a.dependencies) ? a.dependencies : null;
  if (typeof a.work !== "string" || typeof a.material_result !== "boolean" || !Array.isArray(a.evidence) || !deps || typeof a.watermark !== "string") return null;
  if (!a.evidence.every((e) => typeof e === "string")) return null;
  const dependencies: SilenceClaim["dependencies"] = [];
  for (const d of deps) {
    const x = d as Record<string, unknown> | null;
    if (!x || typeof x.tool !== "string" || typeof x.available !== "boolean" || typeof x.workaround !== "boolean") return null;
    dependencies.push({ tool: x.tool, available: x.available, workaround: x.workaround });
  }
  return { work: a.work, material_result: a.material_result, evidence: a.evidence as string[], dependencies, watermark: a.watermark };
}

/**
 * The checklist, each item decided from the run's log: the work ran (a read in this run succeeded, or
 * the gate opened on a fresh observation), no material result, every piece of evidence is a successful
 * call of this run, every read the run depended on was available and none failed and was routed around,
 * and a watermark to write. A failure lists every item that did not hold.
 */
export function certifySilence(args: unknown, log: CallRecord[], gateObserved: boolean): SilenceVerdict {
  const claim = parseClaim(args);
  if (!claim) return { ok: false, codes: [{ code: "SILENCE_CLAIM_INVALID", reason: "nothing_to_report takes work, material_result, evidence, dependencies and watermark" }] };
  const codes: Array<{ code: SilenceCode; reason: string }> = [];
  const reads = log.filter((c) => !c.refused);
  const good = new Set(reads.filter((c) => c.ok).map((c) => c.id));
  if (good.size === 0 && !gateObserved) codes.push({ code: "SILENCE_NO_WORK", reason: "no read in this run succeeded, so nothing was checked" });
  if (claim.material_result) codes.push({ code: "SILENCE_MATERIAL_RESULT", reason: "the run found a material result: call report" });
  const stale = claim.evidence.filter((e) => !(good.has(e) || (e === "gate" && gateObserved)));
  if (!claim.evidence.length || stale.length) codes.push({ code: "SILENCE_STALE_EVIDENCE", reason: claim.evidence.length ? `not a successful call of this run: ${stale.join(", ")}` : "no evidence named" });
  const failed = reads.filter((c) => !c.ok);
  const down = claim.dependencies.filter((d) => !d.available).map((d) => d.tool);
  if (failed.length || down.length) {
    const named = [...failed.map((c) => `${c.tool} (${c.code ?? "failed"})`), ...down.map((t) => `${t} (declared unavailable)`)];
    codes.push({ code: "SILENCE_DEPENDENCY_UNAVAILABLE", reason: `a dependency was not available: ${named.join(", ")}; say so with report` });
  }
  const unread = claim.dependencies.filter((d) => d.available && !reads.some((c) => c.ok && c.tool === d.tool)).map((d) => d.tool);
  const routed = claim.dependencies.filter((d) => d.workaround).map((d) => d.tool);
  if (routed.length || unread.length) codes.push({ code: "SILENCE_WORKAROUND", reason: [routed.length ? `replaced by a workaround: ${routed.join(", ")}` : "", unread.length ? `declared available but not read in this run: ${unread.join(", ")}` : ""].filter(Boolean).join("; ") });
  const mark = claim.watermark.trim();
  if (!mark || mark.length > MAX_WATERMARK) codes.push({ code: "SILENCE_NO_WATERMARK", reason: `a watermark of 1 to ${MAX_WATERMARK} characters is written for the next run` });
  return codes.length ? { ok: false, codes } : { ok: true, claim: { ...claim, watermark: mark } };
}
