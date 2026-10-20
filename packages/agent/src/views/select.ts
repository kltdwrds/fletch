// `db_query`'s statement check (M24.2): one read-only SELECT over one named view, decided in code by an
// allow-list of tokens, never by the model's word or a SQL parser's leniency. A statement passes only
// when every token is a listed keyword, one of the view's columns, an alias it declares with `AS`, a
// number, a single-quoted string or a listed operator, its one `FROM` names the view, and it holds no
// second `SELECT`. Anything else is refused with a stable code and a reason. The checked statement then
// runs over a common table expression the owning object writes: the view's own SELECT, scoped to the
// person by a bound parameter, so the statement can read nothing but that person's rows of that view.
// The store's columns are checked against the view's definition first, and the caller's pinned view
// schema version against the object's, so a view that drifted from its store is refused, not guessed.

export type ViewRow = Record<string, SqlStorageValue>;

export type ViewResult = { ok: true; view: string; rows: ViewRow[]; truncated: boolean } | { ok: false; code: ViewCode; reason: string };

export type ViewCode =
  | "DB_QUERY_NOT_SELECT"
  | "DB_QUERY_MULTIPLE_STATEMENTS"
  | "DB_QUERY_SUBSELECT"
  | "DB_QUERY_UNKNOWN_VIEW"
  | "DB_QUERY_UNKNOWN_IDENTIFIER"
  | "DB_VIEW_SCHEMA_MISMATCH"
  | "DB_QUERY_FAILED"
  | "DB_QUERY_TIMEOUT";

/** One view an object answers: its SELECT over the store, its columns, and the store columns it needs. */
export interface ViewDef {
  name: string;
  /** The view's SELECT; exactly one `?`, bound to the person, in a store holding several people's rows; none in a single-owner store. */
  base: string;
  columns: string[];
  requires: Array<{ table: string; columns: string[] }>;
}

export interface ViewInput {
  view: string;
  sql: string;
  /** The view schema version the caller was built against. */
  version: number;
}

/** The rows a query returns at most; one more is read to say the answer was cut. */
export const DB_QUERY_MAX_ROWS = 200;

/** The parts of the object's SQL storage a query uses. */
/** The store's SQL as the views read it: a Durable Object's `SqlStorage`, or a test's SQLite with its shape. */
export type ViewSql = Pick<SqlStorage, "exec">;

const KEYWORDS = new Set(["SELECT", "DISTINCT", "FROM", "WHERE", "AND", "OR", "NOT", "IS", "NULL", "LIKE", "IN", "BETWEEN", "GROUP", "BY", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "AS", "COUNT", "SUM", "MIN", "MAX", "AVG"]);
const OPERATORS = ["<=", ">=", "<>", "!=", "=", "<", ">", "+", "-", "*", "/", ",", "(", ")", ";"];
/** Words that follow the view in its clause: anything else there (an alias, a join, a comma) is refused. */
const AFTER_VIEW = new Set(["WHERE", "GROUP", "ORDER", "LIMIT"]);

type Token = { kind: "word" | "number" | "string" | "op"; text: string };
type Refusal = { ok: false; code: ViewCode; reason: string };
const refuse = (code: ViewCode, reason: string): Refusal => ({ ok: false, code, reason });

function tokenize(sql: string): { ok: true; tokens: Token[] } | Refusal {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i) || sql.startsWith("/*", i)) return refuse("DB_QUERY_UNKNOWN_IDENTIFIER", "comments are not accepted");
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return refuse("DB_QUERY_UNKNOWN_IDENTIFIER", "a string is not closed");
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      tokens.push({ kind: "string", text: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(sql.slice(i));
    if (number) {
      tokens.push({ kind: "number", text: number[0] });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i));
    if (word) {
      tokens.push({ kind: "word", text: word[0] });
      i += word[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => sql.startsWith(o, i));
    if (op) {
      tokens.push({ kind: "op", text: op });
      i += op.length;
      continue;
    }
    if (c === '"' || c === "[" || c === "`") return refuse("DB_QUERY_UNKNOWN_IDENTIFIER", "quoted identifiers are not accepted; name a column of the view");
    return refuse("DB_QUERY_UNKNOWN_IDENTIFIER", `the character ${JSON.stringify(c)} is not accepted`);
  }
  return { ok: true, tokens };
}

/**
 * Checks `sql` against the allow-list for `view`; on success the statement rebuilt from its tokens, with
 * the view's name replaced by `alias`, the name the owning object gives its scoped rows.
 */
export function checkSelect(sql: string, view: ViewDef, alias: string): { ok: true; statement: string } | Refusal {
  const lexed = tokenize(sql);
  if (!lexed.ok) return lexed;
  const tokens = lexed.tokens;
  if (tokens.at(-1)?.text === ";") tokens.pop();
  if (!tokens.length) return refuse("DB_QUERY_NOT_SELECT", "the statement is empty");
  if (tokens.some((t) => t.text === ";")) return refuse("DB_QUERY_MULTIPLE_STATEMENTS", "one statement per call");
  const upper = (t: Token | undefined) => (t?.kind === "word" ? t.text.toUpperCase() : "");
  if (upper(tokens[0]) !== "SELECT") return refuse("DB_QUERY_NOT_SELECT", "only a SELECT reads a view; writes, PRAGMA and ATTACH are refused");
  if (tokens.filter((t) => upper(t) === "SELECT").length > 1) return refuse("DB_QUERY_SUBSELECT", "a sub-select is not accepted; query the view itself");
  const froms = tokens.flatMap((t, i) => (upper(t) === "FROM" ? [i] : []));
  if (froms.length !== 1) return refuse("DB_QUERY_UNKNOWN_VIEW", `name the view once: FROM ${view.name}`);
  const at = froms[0] as number;
  const target = tokens[at + 1];
  if (target?.kind !== "word" || target.text.toLowerCase() !== view.name) return refuse("DB_QUERY_UNKNOWN_VIEW", `this call reads the view ${view.name} only`);
  const next = tokens[at + 2];
  if (next && !AFTER_VIEW.has(upper(next))) return refuse("DB_QUERY_UNKNOWN_VIEW", "joins, aliases and further tables are not accepted after the view");
  const columns = new Set(view.columns.map((c) => c.toLowerCase()));
  const aliases = new Set(tokens.flatMap((t, i) => (upper(t) === "AS" && tokens[i + 1]?.kind === "word" ? [(tokens[i + 1] as Token).text.toLowerCase()] : [])));
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== "word" || i === at + 1) continue;
    const name = t.text.toLowerCase();
    if (!KEYWORDS.has(t.text.toUpperCase()) && !columns.has(name) && !aliases.has(name)) {
      return refuse("DB_QUERY_UNKNOWN_IDENTIFIER", `${t.text} is not a column of ${view.name} or an accepted keyword`);
    }
  }
  const statement = tokens.map((t, i) => (i === at + 1 ? alias : t.text)).join(" ");
  return { ok: true, statement };
}

/** The view's required store columns that are missing; empty when the store matches the definition. */
/** The object's schema version: how many of its named migrations (`<kind>.…`) the store has applied; 0 before the table exists. */
export function schemaVersion(sql: ViewSql, kind: string): number {
  if (!sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").toArray().length) return 0;
  return Number(sql.exec<{ n: number }>("SELECT count(*) AS n FROM migrations WHERE name LIKE ?", `${kind}.%`).toArray()[0]?.n ?? 0);
}

export function schemaDrift(sql: ViewSql, view: ViewDef): string[] {
  const missing: string[] = [];
  for (const r of view.requires) {
    const have = new Set(sql.exec<{ name: string }>("SELECT name FROM pragma_table_info(?)", r.table).toArray().map((c) => c.name));
    for (const c of r.columns) if (!have.has(c)) missing.push(`${r.table}.${c}`);
  }
  return missing;
}

/**
 * Runs one checked query for `person` (null in a single-owner store, whose views bind nothing) over the
 * object's own views, at the version its migration table records (M25.3). The caller has decided the person is the store's owner.
 */
export function runView(sql: ViewSql, kind: string, views: ViewDef[], input: ViewInput, person: string | null): ViewResult {
  const version = schemaVersion(sql, kind);
  const view = views.find((v) => v.name === input.view);
  if (!view) return refuse("DB_QUERY_UNKNOWN_VIEW", `no view ${JSON.stringify(input.view)}; the views are ${views.map((v) => v.name).join(", ")}`);
  if (input.version !== version) return refuse("DB_VIEW_SCHEMA_MISMATCH", `the views are at version ${version}, the call expected ${input.version}`);
  const drift = schemaDrift(sql, view);
  if (drift.length) return refuse("DB_VIEW_SCHEMA_MISMATCH", `the store does not hold ${drift.join(", ")} that view version ${version} reads`);
  const alias = `qv_${view.name}`;
  const checked = checkSelect(input.sql, view, alias);
  if (!checked.ok) return checked;
  const bindings = view.base.includes("?") ? [person] : [];
  try {
    const rows = sql.exec<ViewRow>(`WITH ${alias} AS (${view.base}) SELECT * FROM (${checked.statement}) LIMIT ${DB_QUERY_MAX_ROWS + 1}`, ...bindings).toArray();
    return { ok: true, view: view.name, rows: rows.slice(0, DB_QUERY_MAX_ROWS), truncated: rows.length > DB_QUERY_MAX_ROWS };
  } catch (err) {
    return refuse("DB_QUERY_FAILED", String(err instanceof Error ? err.message : err));
  }
}
