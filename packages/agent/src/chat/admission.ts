// A turn's admission (M17.1, QYVR-157): the Ledger is asked once before a turn waits on anything, so
// under an exhausted budget every attempt fails at once with the same frame, rather than after
// memory, compaction or the outbox. A refusal is recorded as the adapter records one, a `refused`
// call row with its code and no tokens; the adapter still asks before every model call.
import type { LedgerSink } from "../ledger/types.ts";

export type Admitted = { ok: true } | { ok: false; code: string; reason: string };

const detail = (err: unknown) => String(err instanceof Error ? err.message : err);

export async function admitTurn(ledger: LedgerSink, who: { tenant: string; person: string; turnId: string; model: string }, now: () => number): Promise<Admitted> {
  if (!ledger.admit) return { ok: true };
  let admitted: Admitted;
  try {
    admitted = await ledger.admit({ person: who.person, runId: who.turnId, model: who.model });
  } catch (err) {
    admitted = { ok: false, code: "BUDGET_UNAVAILABLE", reason: `the allowance could not be read: ${detail(err)}` };
  }
  if (admitted.ok) return admitted;
  const row = { tenant: who.tenant, person: who.person, runId: who.turnId, route: "chat" as const, model: who.model, attempt: 1, status: "refused" as const, code: admitted.code, httpStatus: null, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: now(), startedAt: null, firstTokenAt: null, finishedAt: null };
  const recorded = await ledger.record(row).then(() => true, () => false);
  return recorded ? admitted : { ...admitted, reason: `${admitted.reason}; LEDGER_UNAVAILABLE: the row was not written` };
}
