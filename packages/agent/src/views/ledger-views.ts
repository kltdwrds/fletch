// The `Ledger`'s views for `db_query` (M24.2): the tenant's Ledger holds every member's rows, so each
// view is its SELECT with `WHERE person = ?`, bound to the person the chat's owner is, never to anything
// the model wrote. A query naming another person reads that person's rows of nothing. `runs` is answered
// here, where every job's run rows already are (the `Job` writes them on each phase change), so one
// query needs no fan-out to each job. No view carries content: these rows are identifiers, codes,
// tokens and times. A call carries the version this build reads
// (`LEDGER_VIEW_SCHEMA_VERSION`, the length of the Ledger's migration list); the Ledger answers at its own migration table's version (M25.3).
import { LEDGER_MIGRATIONS } from "../migrations/catalog.ts";
import { runView, type ViewDef, type ViewInput, type ViewResult, type ViewSql } from "./select.ts";

export const LEDGER_VIEW_SCHEMA_VERSION = LEDGER_MIGRATIONS.length;

const CALL_COLUMNS = ["person", "run_id", "route", "model", "provider", "attempt", "status", "code", "http_status", "input_tokens", "output_tokens", "reasoning_tokens", "cached_tokens", "cost_micros", "at", "started_at", "first_token_at", "finished_at"];

export const LEDGER_VIEWS: ViewDef[] = [
  {
    name: "ledger_rows",
    base: `SELECT ${CALL_COLUMNS.join(", ")} FROM model_calls WHERE person = ?`,
    columns: CALL_COLUMNS,
    requires: [{ table: "model_calls", columns: CALL_COLUMNS }],
  },
  {
    name: "runs",
    base: "SELECT person, run_id, job_id, scheduled_for, json_extract(body, '$.phase') AS phase, json_extract(body, '$.signal') AS signal, json_extract(body, '$.code') AS code, json_extract(body, '$.tokens') AS tokens, updated_at FROM job_runs WHERE person = ?",
    columns: ["person", "run_id", "job_id", "scheduled_for", "phase", "signal", "code", "tokens", "updated_at"],
    requires: [{ table: "job_runs", columns: ["person", "run_id", "job_id", "scheduled_for", "body", "updated_at"] }],
  },
  {
    name: "turn_ends",
    base: "SELECT person, chat_id, turn_id, outcome, steps, at FROM turn_ends WHERE person = ?",
    columns: ["person", "chat_id", "turn_id", "outcome", "steps", "at"],
    requires: [{ table: "turn_ends", columns: ["person", "chat_id", "turn_id", "outcome", "steps", "at"] }],
  },
];

/** One checked query over `person`'s rows of the Ledger's views. */
export function queryLedgerView(sql: ViewSql, person: string, input: ViewInput): ViewResult {
  return runView(sql, "ledger", LEDGER_VIEWS, input, person);
}
