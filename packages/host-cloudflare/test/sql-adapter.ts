// Node's SQLite in the shape of a Durable Object's `sql` + `transactionSync`, for the hermetic lane.
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "../src/passkeys/store.ts";

export function memorySql(): Sql {
  const db = new DatabaseSync(":memory:");
  let savepoints = 0;
  const exec = (query: string, ...bindings: unknown[]) => {
    let rows: Record<string, unknown>[] = [];
    if (!bindings.length && query.split(";").filter((s) => s.trim()).length > 1) db.exec(query);
    else {
      const stmt = db.prepare(query);
      const args = bindings as never[];
      if (stmt.columns().length) rows = stmt.all(...args).map((r: Record<string, unknown>) => ({ ...r }));
      else stmt.run(...args);
    }
    return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
  };
  const transactionSync = <R>(fn: () => R): R => {
    const sp = `sp${++savepoints}`;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const out = fn();
      db.exec(`RELEASE ${sp}`);
      return out;
    } catch (err) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw err;
    }
  };
  return { sql: { exec }, transactionSync } as unknown as Sql;
}
