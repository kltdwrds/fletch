// The agent's structured logs (M15.3): one JSON object per line with an `event` name and fields that are
// identifiers, codes, counts or flags. A string field that could carry prose (any whitespace, any character
// outside the identifier set, or over 200 characters) is dropped and its name listed under `dropped`, so no
// message, page, mail or tool text reaches the logs whatever a caller passes.

export type Field = string | number | boolean | null;
export type Level = "info" | "error";

export interface LogLine {
  event: string;
  level: Level;
  dropped?: string[];
  [field: string]: Field | string[] | undefined;
}

/** Identifiers, codes, emails, paths and comma lists; no whitespace, so no sentence fits. */
export const SAFE_VALUE = /^[A-Za-z0-9:._@/+=,-]{0,200}$/;
export const EVENT_NAME = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+){0,4}$/;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const RESERVED = new Set(["event", "level", "dropped"]);

/** The line for `event`, with every unsafe field left out and named under `dropped`. */
export function logLine(event: string, fields: Record<string, unknown> = {}, level: Level = "info"): LogLine {
  const line: LogLine = { event: EVENT_NAME.test(event) ? event : "log.invalid_event", level };
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (RESERVED.has(k) || !FIELD_NAME.test(k)) {
      dropped.push(FIELD_NAME.test(k) ? k : "invalid_name");
      continue;
    }
    const ok = v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && SAFE_VALUE.test(v));
    if (ok) line[k] = v as Field;
    else dropped.push(k);
  }
  if (dropped.length) line.dropped = dropped;
  return line;
}

/** Writes one structured line: `console.error` for an error, `console.log` otherwise. */
export function log(event: string, fields: Record<string, unknown> = {}, level: Level = "info"): LogLine {
  const line = logLine(event, fields, level);
  (level === "error" ? console.error : console.log)(JSON.stringify(line));
  return line;
}

/** A caught value as a field: the error's class name, never its message. */
export const errorName = (err: unknown): string => (err instanceof Error ? err.name : typeof err);

/** A line given as one object with its `event` among the fields, as the ingress and mail paths emit them. */
export function logObject(e: Record<string, unknown>, level: "info" | "error" = "info") {
  const { event, ...fields } = e;
  return log(typeof event === "string" ? event : "log.invalid_event", fields, level);
}
