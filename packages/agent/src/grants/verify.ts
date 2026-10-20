// The verifier for the whole authority model (authority-model.md "Verifiers and evals"): every
// automatic action in the journal cites a grant id, and the cited grant covers the action as the
// engine resolves it at the row's instant. Amount and recipient constraints are not in a content-free
// row, so they are checked at the gate only; window, rate, expiry, revocation, tier and chain are
// re-checked here.
import { resolve } from "./engine.ts";
import { type JournalRow, parseParty, parseSubjectRef } from "./journal.ts";
import type { CompanyView, Descriptor, Grant } from "./types.ts";

export interface JournalViolation {
  row: string;
  code: "AUTO_WITHOUT_GRANT" | "GRANT_UNKNOWN" | "GRANT_DOES_NOT_COVER" | "ROW_UNREADABLE";
  detail: string;
}

/** Actions that ran: an automatic decision whose outcome is not a refusal. */
export const ranAutomatically = (r: JournalRow) => r.decision === "auto" && r.outcome === "DONE";

export function verifyJournal(rows: readonly JournalRow[], grants: readonly Grant[], company: CompanyView): JournalViolation[] {
  const out: JournalViolation[] = [];
  const uses: Record<string, number[]> = {};
  for (const r of [...rows].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    if (!ranAutomatically(r)) continue;
    if (!r.grantId) {
      out.push({ row: r.id, code: "AUTO_WITHOUT_GRANT", detail: `${r.actionKind} ran with no grant id` });
      continue;
    }
    const cited = grants.find((g) => g.id === r.grantId);
    if (!cited) {
      out.push({ row: r.id, code: "GRANT_UNKNOWN", detail: `${r.grantId} is not a grant` });
      continue;
    }
    const subject = parseSubjectRef(r.subjectRef);
    const counterpart = parseParty(r.counterpart);
    if (!subject || !counterpart) {
      out.push({ row: r.id, code: "ROW_UNREADABLE", detail: "subject or counterpart" });
      continue;
    }
    const d: Descriptor = { actor: r.actor, principal: r.principal, actionKind: r.actionKind, subject, counterpart, origin: r.origin, hops: r.hops, at: r.at };
    // The grants as they stood at the row: a one-shot used by this row was still unused before it.
    const asAt = grants.map((g) => (g.used_at !== undefined && g.used_at >= r.at ? { ...g, used_at: undefined } : g)).filter((g) => g.created_at <= r.at);
    const again = resolve(d, asAt, company, uses);
    if (again.decision !== "auto" || again.grantId !== r.grantId) {
      out.push({ row: r.id, code: "GRANT_DOES_NOT_COVER", detail: `re-resolved to ${again.decision} (${again.code}) on ${again.grantId ?? "no grant"}` });
    }
    uses[r.grantId] = [...(uses[r.grantId] ?? []), r.at];
  }
  return out;
}
