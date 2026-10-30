// A Durable Object test harness over Node's SQLite, for the hermetic lane. One harness is one
// object id: its storage (a SQLite database, alarms, accepted sockets) outlives any instance, as
// the platform's does. `evict()` kills the current instance the way an eviction does: every storage
// call, socket lookup and binding call it makes afterwards throws `EVICTED`, so nothing a dead
// instance still has in flight can write, deliver or call out. The next use builds a fresh
// instance over the same storage, which is how recovery is tested without a method call.
import { DatabaseSync } from "node:sqlite";
import { HARNESS_MIGRATIONS } from "../../packages/agent/src/migrations/catalog.ts";
import { migrate } from "../../packages/agent/src/migrations/engine.ts";

export class Evicted extends Error {
  readonly code = "EVICTED";
  constructor() {
    super("EVICTED: this object instance was evicted");
  }
}

export interface HarnessSocket {
  readonly frames: Array<Record<string, unknown>>;
  send(data: string): void;
}

type Bindable = string | number | bigint | null | Uint8Array;
type Cursor = { toArray(): Record<string, unknown>[]; one(): Record<string, unknown> | undefined; [Symbol.iterator](): Iterator<Record<string, unknown>> };

export type ObjectFactory<T> = (ctx: unknown, env: unknown) => T;

export class ObjectHarness<T extends object> {
  readonly db = new DatabaseSync(":memory:");
  private alarm: number | null = null;
  private readonly kv = new Map<string, unknown>();
  /** Off for a dormant object: the storage is left as the test made it, and the real class's constructor migrates it. */
  autoMigrate = true;
  private readonly sockets: HarnessSocket[] = [];
  private current: T | undefined;
  private generation = 0;
  private savepoints = 0;
  readonly name: string;
  private readonly factory: ObjectFactory<T>;
  private readonly env: Record<string, unknown>;
  /** Applied to every new instance, e.g. to replace its clock and retry wait. */
  private readonly setup: (instance: T) => void;

  constructor(name: string, factory: ObjectFactory<T>, env: Record<string, unknown>, setup: (instance: T) => void = () => {}) {
    this.name = name;
    this.factory = factory;
    this.env = env;
    this.setup = setup;
  }

  /** The live instance, built on first use and after every eviction. */
  get instance(): T {
    if (!this.current) {
      const gen = ++this.generation;
      this.current = this.factory(this.ctx(gen), revocable(this.env, () => gen !== this.generation));
      this.setup(this.current);
    }
    return this.current;
  }

  /** Evicts the current instance; whatever it still runs is cut off from storage and bindings. */
  evict(): void {
    this.generation++;
    this.current = undefined;
  }

  get alarmAt(): number | null {
    return this.alarm;
  }

  /** Fires the pending alarm on the live instance, as the platform would after the deadline. */
  async fireAlarm(): Promise<void> {
    if (this.alarm === null) throw new Error("HARNESS_NO_ALARM: no alarm is set");
    this.alarm = null;
    await (this.instance as unknown as { alarm(): Promise<void> }).alarm();
  }

  /** A hibernatable socket the object has accepted; it survives eviction, as the platform's do. */
  connect(): HarnessSocket {
    const socket: HarnessSocket = { frames: [], send: (data) => socket.frames.push(JSON.parse(data)) };
    this.sockets.push(socket);
    return socket;
  }

  /** Reads storage directly, for assertions. */
  rows(query: string, ...bindings: Bindable[]): Record<string, unknown>[] {
    return this.db.prepare(query).all(...bindings).map((r) => ({ ...r }));
  }

  private ctx(gen: number) {
    const live = () => {
      if (gen !== this.generation) throw new Evicted();
    };
    const exec = (query: string, ...bindings: unknown[]): Cursor => {
      live();
      const args = bindings.map((b) => (b === undefined ? null : typeof b === "boolean" ? Number(b) : b)) as Bindable[];
      let rows: Record<string, unknown>[] = [];
      if (!args.length && query.split(";").filter((s) => s.trim()).length > 1) this.db.exec(query);
      else {
        const stmt = this.db.prepare(query);
        if (stmt.columns().length) rows = stmt.all(...args).map((r) => ({ ...r }));
        else stmt.run(...args);
      }
      return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
    };
    const ctx = {
      id: { name: this.name, toString: () => this.name },
      storage: {
        sql: { exec },
        // The synchronous KV the Agents SDK keeps its own schema version in; it lives with the storage, not the instance.
        get: async (k: string) => this.kv.get(k),
        put: async (k: string, v: unknown) => void this.kv.set(k, v),
        delete: async (k: string) => this.kv.delete(k),
        kv: { get: (k: string) => this.kv.get(k), put: (k: string, v: unknown) => void this.kv.set(k, v), delete: (k: string) => this.kv.delete(k) },
        transactionSync: <R>(fn: () => R): R => {
          live();
          const sp = `sp${++this.savepoints}`;
          this.db.exec(`SAVEPOINT ${sp}`);
          try {
            const out = fn();
            live();
            this.db.exec(`RELEASE ${sp}`);
            return out;
          } catch (err) {
            this.db.exec(`ROLLBACK TO ${sp}`);
            this.db.exec(`RELEASE ${sp}`);
            throw err;
          }
        },
        // As the platform's: every table of the object's SQLite goes, and the alarm with it. A virtual table
        // goes before the shadow tables it owns, each drop read afresh from the schema.
        deleteAll: async () => {
          live();
          for (;;) {
            const next = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY (sql LIKE 'CREATE VIRTUAL%') DESC, name LIMIT 1").get() as { name: string } | undefined;
            if (!next) break;
            this.db.exec(`DROP TABLE "${next.name.replaceAll('"', '""')}"`);
          }
          this.alarm = null;
        },
        setAlarm: async (at: number | Date) => {
          live();
          this.alarm = typeof at === "number" ? at : at.getTime();
        },
        getAlarm: async () => {
          live();
          return this.alarm;
        },
        deleteAlarm: async () => {
          live();
          this.alarm = null;
        },
      },
      getWebSockets: () => {
        live();
        return [...this.sockets];
      },
      waitUntil: () => {},
      blockConcurrencyWhile: async <R>(fn: () => Promise<R>) => {
        live();
        return fn();
      },
    };
    // One storage stands in for any object here, so it holds every object's tables, as the named migrations make them; the real
    // classes apply their own list in their constructors (test/m25/m25-3-migrations.test.ts holds that to account).
    if (this.autoMigrate) migrate(ctx.storage as never, HARNESS_MIGRATIONS);
    return ctx;
  }
}

/** Wraps bindings so calls made through them, and through objects they return, throw once revoked. */
function revocable<V>(value: V, revoked: () => boolean): V {
  if (value === null || typeof value !== "object") return value;
  return new Proxy(value as object, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v === "function") {
        return (...args: unknown[]) => {
          if (revoked()) throw new Evicted();
          const out = v.apply(target, args);
          if (out instanceof Promise) {
            return out.then((r) => {
              if (revoked()) throw new Evicted();
              return r;
            });
          }
          return out && typeof out === "object" && !(out instanceof Response) ? revocable(out, revoked) : out;
        };
      }
      return v && typeof v === "object" ? revocable(v, revoked) : v;
    },
  }) as V;
}

/** A namespace binding whose stubs are the live instances of harnesses, created per name. */
export function harnessNamespace<T extends object>(make: (name: string) => ObjectHarness<T>) {
  const harnesses = new Map<string, ObjectHarness<T>>();
  const of = (name: string) => {
    let h = harnesses.get(name);
    if (!h) {
      h = make(name);
      harnesses.set(name, h);
    }
    return h;
  };
  return {
    harness: of,
    /** Every harness made so far, by name. */
    all: () => [...harnesses.entries()],
    binding: {
      idFromName: (name: string) => ({ name, toString: () => name }),
      get: (id: { name: string }) => of(id.name).instance,
    },
  };
}
