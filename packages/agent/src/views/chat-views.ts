// The `Chat` object's views for `db_query` (M24.2): what the agent may read of its own work in this
// chat, as rows of identifiers, codes, counts and times. No view carries a message body, a tool's
// arguments or the model's thinking: the transcript is the chat's record, and these explain it. A chat
// has one owner, so the views bind no person; the engine checks the owner before it asks.
// A call carries the version this build reads (`CHAT_VIEW_SCHEMA_VERSION`, the length of the Chat's migration list); the store answers at
// the version its own migration table records, so a store behind the build is refused, not guessed (M25.3).
import { CHAT_MIGRATIONS } from "../migrations/catalog.ts";
import { runView, type ViewDef, type ViewInput, type ViewResult, type ViewSql } from "./select.ts";

export const CHAT_VIEW_SCHEMA_VERSION = CHAT_MIGRATIONS.length;

export const CHAT_VIEWS: ViewDef[] = [
  {
    name: "turns",
    base: "SELECT id, status, code, reason, steps, input_tokens, started_at, ended_at FROM turns",
    columns: ["id", "status", "code", "reason", "steps", "input_tokens", "started_at", "ended_at"],
    requires: [{ table: "turns", columns: ["id", "status", "code", "reason", "steps", "input_tokens", "started_at", "ended_at"] }],
  },
  {
    name: "outbox",
    base: "SELECT id, turn_id, json_extract(payload, '$.kind') AS kind, json_extract(payload, '$.tool') AS tool, delivered_at FROM outbox",
    columns: ["id", "turn_id", "kind", "tool", "delivered_at"],
    requires: [{ table: "outbox", columns: ["id", "turn_id", "payload", "delivered_at"] }],
  },
  {
    name: "delivery",
    base: "SELECT id, turn_id, json_extract(payload, '$.kind') AS kind, CASE WHEN delivered_at IS NULL THEN 'pending' ELSE 'delivered' END AS state, delivered_at FROM outbox",
    columns: ["id", "turn_id", "kind", "state", "delivered_at"],
    requires: [{ table: "outbox", columns: ["id", "turn_id", "payload", "delivered_at"] }],
  },
  {
    name: "compactions",
    base: "SELECT id, turn_id, trigger, status, code, reason, tokens_before, tokens_after, at FROM compactions",
    columns: ["id", "turn_id", "trigger", "status", "code", "reason", "tokens_before", "tokens_after", "at"],
    requires: [{ table: "compactions", columns: ["id", "turn_id", "trigger", "status", "code", "reason", "tokens_before", "tokens_after", "at"] }],
  },
  {
    name: "mailbox",
    base: "SELECT ordinal, message_id, epoch, kind, scope, state, turn_id, delivery, accepted_at, settled_at FROM mailbox",
    columns: ["ordinal", "message_id", "epoch", "kind", "scope", "state", "turn_id", "delivery", "accepted_at", "settled_at"],
    requires: [{ table: "mailbox", columns: ["ordinal", "message_id", "epoch", "kind", "scope", "state", "turn_id", "delivery", "accepted_at", "settled_at"] }],
  },
];

/** One checked query over this chat's views; the caller has decided the requester owns the chat. */
export function queryChatView(sql: ViewSql, input: ViewInput): ViewResult {
  return runView(sql, "chat", CHAT_VIEWS, input, null);
}
