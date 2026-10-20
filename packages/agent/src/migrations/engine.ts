// Named schema migrations (M25.3). Every object keeps a `migrations(name, applied_at, release)` table; a schema change is a
// named, idempotent function in that object's list (`catalog.ts`), applied in order by the object's constructor under
// `blockConcurrencyWhile`. A name is applied once and recorded; the list only grows, and a store never creates its own tables.
type Storage = Pick<DurableObjectStorage, "sql" | "transactionSync">;

export interface Migration {
  /** Unique in the object's list; never renamed once released, since the table records it. */
  name: string;
  /** The release that introduced it (a part id), recorded beside the name when it is applied. */
  release: string;
  /** Idempotent: it must be safe on a store that already holds the change. */
  up(sql: SqlStorage): void;
}

const TABLE = "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL, release TEXT NOT NULL)";

export interface Applied {
  /** Names this call applied, in order. */
  applied: string[];
}

/** Applies each migration of `list` not yet recorded, in order, each in its own transaction with its record. */
export function migrate(storage: Storage, list: readonly Migration[], now: () => number = Date.now): Applied {
  const names = new Set<string>();
  for (const m of list) {
    if (names.has(m.name)) throw new Error(`MIGRATION_DUPLICATE: ${m.name} appears twice in one object's list`);
    names.add(m.name);
  }
  storage.sql.exec(TABLE);
  const done = new Set(storage.sql.exec<{ name: string }>("SELECT name FROM migrations").toArray().map((r) => r.name));
  const applied: string[] = [];
  for (const m of list) {
    if (done.has(m.name)) continue;
    storage.transactionSync(() => {
      m.up(storage.sql);
      storage.sql.exec("INSERT INTO migrations (name, applied_at, release) VALUES (?, ?, ?)", m.name, now(), m.release);
    });
    applied.push(m.name);
  }
  return { applied };
}

/** What the store holds against the list: how many are recorded, and which of the list it has not applied. */
export function migrationStatus(storage: Pick<DurableObjectStorage, "sql">, list: readonly Migration[]): { recorded: number; behind: string[] } {
  const has = storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").toArray().length > 0;
  const done = has ? new Set(storage.sql.exec<{ name: string }>("SELECT name FROM migrations").toArray().map((r) => r.name)) : new Set<string>();
  return { recorded: done.size, behind: list.filter((m) => !done.has(m.name)).map((m) => m.name) };
}

/** The newest release recorded in the store (the version the views read), or null before any migration. */
export function schemaRelease(sql: Pick<SqlStorage, "exec">): string | null {
  const has = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").toArray().length > 0;
  if (!has) return null;
  return sql.exec<{ release: string }>("SELECT release FROM migrations ORDER BY applied_at DESC, rowid DESC LIMIT 1").toArray()[0]?.release ?? null;
}

/** A migration that runs one DDL script (every statement `IF NOT EXISTS`). */
export function schema(name: string, release: string, ddl: string): Migration {
  return { name, release, up: (sql) => void sql.exec(ddl) };
}

/** A migration that adds columns to a table where they are missing. */
export function addColumns(name: string, release: string, table: string, columns: Record<string, string>): Migration {
  return {
    name,
    release,
    up(sql) {
      const have = new Set(sql.exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).toArray().map((c) => c.name));
      for (const [column, type] of Object.entries(columns)) if (!have.has(column)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    },
  };
}

/** The constructor's call: the object takes no event until its list is applied. */
export function migrateInConstructor(ctx: Pick<DurableObjectState, "storage" | "blockConcurrencyWhile">, list: readonly Migration[]): Applied {
  const held: Applied = { applied: [] };
  void ctx.blockConcurrencyWhile(async () => {
    held.applied = migrate(ctx.storage, list).applied;
  });
  return held;
}
