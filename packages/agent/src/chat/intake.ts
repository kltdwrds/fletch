// Opening a turn from a person's mailbox row (M24.2, beside `engine.ts` to keep it under the file cap):
// the Ledger is asked first (M17.1), the standing files read, and the turn, the person's message and the
// row's `started` mark stored in one transaction. A send refused before any turn (memory unreadable)
// keeps nothing; a row that waited in the mailbox is never refused silently: its turn opens and fails
// with the code, so the person sees what happened to it.
import type { LedgerSink } from "../ledger/types.ts";
import { type ModelConfig, modelFor } from "../model/routes.ts";
import type { StandingCopy } from "../memory/standing.ts";
import { extractUrls, UrlTable, URLS_KEY } from "../browse/urls.ts";
import { admitTurn } from "./admission.ts";
import type { EngineHooks } from "./hooks.ts";
import { clientIdOf, type Mailbox, type MailRow } from "./mailbox.ts";
import { noteStanding } from "./standing-copy.ts";
import type { ChatStore } from "./store.ts";

export interface IntakeDeps {
  store: ChatStore;
  mailbox: Mailbox;
  hooks: EngineHooks;
  ledger: LedgerSink;
  tenant: string;
  now: () => number;
  /** The deploy's model configuration: the chat route's model the turn is admitted for. */
  models?: ModelConfig;
}

export type Opened = { kind: "refused"; code: "MEMORY_UNAVAILABLE" } | { kind: "started"; turnId: string; at: number; mid: string; failed?: { code: string; reason: string } };

export async function openTurn(d: IntakeDeps, row: MailRow, queued: boolean): Promise<Opened> {
  const turnId = crypto.randomUUID();
  const person = row.person;
  const admitted = await admitTurn(d.ledger, { tenant: d.tenant, person, turnId, model: modelFor("chat", d.models).id }, d.now);
  let standing: StandingCopy[] | undefined;
  let failed = admitted.ok ? undefined : { code: admitted.code, reason: admitted.reason };
  if (admitted.ok && d.hooks.memory) {
    try {
      standing = await d.hooks.memory(person).standingFiles();
    } catch {
      if (!queued) {
        d.store.transaction(() => d.mailbox.forget(row.ordinal));
        return { kind: "refused", code: "MEMORY_UNAVAILABLE" };
      }
      failed = { code: "MEMORY_UNAVAILABLE", reason: "the person's memory could not be read for a message they queued" };
    }
  }
  const at = d.now();
  let seq = 0;
  d.store.transaction(() => {
    if (row.timeZone) d.store.setMeta("timeZone", row.timeZone);
    d.store.startTurn(turnId, person, at);
    if (standing) noteStanding(d.store, turnId, standing, at);
    // A reaction's row is harness text quoting the agent (F10): never drawn as the person's, never their addresses.
    const typed = row.kind !== "reaction";
    seq = d.store.appendMessage(turnId, { role: "user", content: row.text, timestamp: at }, typed && (clientIdOf(row) ?? true));
    d.mailbox.started(row.ordinal, turnId, seq, at);
    // The addresses the person wrote are the ones the browser may open without a page handing them over.
    if (typed && d.hooks.browse) new UrlTable({ get: () => d.store.meta(URLS_KEY) ?? null, set: (v) => d.store.setMeta(URLS_KEY, v) }).add(extractUrls(row.text));
  });
  // The history mid the transcript draws the message by (`visibleHistory`), so the page names its bubble at once (F10).
  return { kind: "started", turnId, at, mid: `m${seq}`, ...(failed ? { failed } : {}) };
}
