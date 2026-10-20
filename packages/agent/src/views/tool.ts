// The `db_query` tool (M24.2): the agent reads its own work, one bounded read-only SELECT per call over a
// named view, answered by the object that owns the view (the chat's own views by the `Chat`, the call,
// run and turn-end rows by the `Ledger`). The tool names the view; which object answers is this table's
// decision, and the person the rows belong to is the chat's owner, never anything in the call. The
// statement check, the 200-row cap and the schema pin are the owning object's (`select.ts`); the tool
// bounds the wait at five seconds and says a refusal with its code.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { CHAT_VIEW_SCHEMA_VERSION, CHAT_VIEWS } from "./chat-views.ts";
import { LEDGER_VIEW_SCHEMA_VERSION, LEDGER_VIEWS } from "./ledger-views.ts";
import type { ViewResult } from "./select.ts";

/** How long a call waits for the owning object's answer before it is answered `DB_QUERY_TIMEOUT`. */
export const DB_QUERY_TIMEOUT_MS = 5_000;

export type ViewOwner = "chat" | "ledger";

/** Each view's owning object and the view schema version this build reads it at. */
export const VIEW_OWNER: Record<string, { owner: ViewOwner; version: number }> = Object.fromEntries([
  ...CHAT_VIEWS.map((v) => [v.name, { owner: "chat" as const, version: CHAT_VIEW_SCHEMA_VERSION }]),
  ...LEDGER_VIEWS.map((v) => [v.name, { owner: "ledger" as const, version: LEDGER_VIEW_SCHEMA_VERSION }]),
]);

/** The rule every answer is read under; it is in the tool's description. */
export const EMPTY_IS_NOT_EVIDENCE =
  "An empty result is not evidence that an action did not happen: say what the view holds, and check the owning record before saying something was not done.";

const VIEW_LINES = [...CHAT_VIEWS, ...LEDGER_VIEWS].map((v) => `${v.name}(${v.columns.join(", ")})`).join("; ");

export interface DbQueryApi {
  /** Runs the checked query at the owning object; the engine routes by `VIEW_OWNER` and binds the owner. */
  query(input: { view: string; sql: string }): Promise<ViewResult>;
}

type Cancel = () => void;

export function dbQueryNamespace(api: DbQueryApi, schedule: (fn: () => void, ms: number) => Cancel): Namespace {
  const tool: ToolSpec = {
    name: "db_query",
    kind: "observation",
    label: "Query your records",
    description:
      `Read your own work in this chat: one SELECT over one view, at most 200 rows. Views: ${VIEW_LINES}. ` +
      `Write FROM <view>; no joins, sub-selects, writes or other tables. ${EMPTY_IS_NOT_EVIDENCE}`,
    parameters: Type.Object({
      view: Type.String({ description: "The view the statement reads, e.g. turns or ledger_rows." }),
      sql: Type.String({ description: "One SELECT over that view, e.g. SELECT status, code FROM turns ORDER BY started_at DESC LIMIT 5." }),
    }),
    execute: async (_id, params) => {
      const p = params as { view: string; sql: string };
      let cancel: Cancel = () => {};
      const timeout = new Promise<ViewResult>((resolve) => {
        cancel = schedule(() => resolve({ ok: false, code: "DB_QUERY_TIMEOUT", reason: `no answer within ${DB_QUERY_TIMEOUT_MS / 1000} s` }), DB_QUERY_TIMEOUT_MS);
      });
      let r: ViewResult;
      try {
        r = await Promise.race([api.query({ view: p.view, sql: p.sql }), timeout]);
      } catch (err) {
        r = { ok: false, code: "DB_QUERY_FAILED", reason: String(err instanceof Error ? err.message : err) };
      } finally {
        cancel();
      }
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      const text = JSON.stringify({ view: r.view, rows: r.rows, truncated: r.truncated });
      return { content: [{ type: "text" as const, text: r.rows.length ? text : `${text}\n${EMPTY_IS_NOT_EVIDENCE}` }], details: { view: r.view, count: r.rows.length, truncated: r.truncated } };
    },
  };
  return { name: "db", description: "db: read-only queries over your own turns, outbox, delivery, compactions, mailbox, Ledger rows, job runs and turn ends", deferral: "names", tools: [tool] };
}
