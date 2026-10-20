// Per-domain engine memory (M9): which engine last served a domain, and whether the domain has told
// this person's agent no. Only a hostname, an engine, a state and a code are kept; never a path, a
// query or page text. A recorded block holds for BLOCK_TTL_MS, during which the domain's scope is
// stopped without a request, and the person's own handoff is the way past it.
export type Engine = "kitesurf" | "chromium" | "live";

export interface DomainMemory {
  domain: string;
  engine: Engine | null;
  state: "ok" | "blocked";
  code: string | null;
  at: number;
}

export interface EngineMemoryApi {
  get(domain: string): Promise<DomainMemory | null>;
  record(row: Omit<DomainMemory, "at">): Promise<void>;
}

export const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

interface Storage {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } };
}

export class PersonBrowse implements EngineMemoryApi {
  private readonly storage: Storage;
  private readonly now: () => number;

  constructor(storage: Storage, now: () => number) {
    this.storage = storage;
    this.now = now;
  }

  private sql(query: string, ...bindings: unknown[]) {
    return this.storage.sql.exec(query, ...bindings).toArray();
  }

  async get(domain: string): Promise<DomainMemory | null> {
    const r = this.sql("SELECT domain, engine, state, code, at FROM browse_domains WHERE domain = ?", domain)[0];
    return r ? { domain: String(r.domain), engine: (r.engine as Engine | null) ?? null, state: r.state === "blocked" ? "blocked" : "ok", code: (r.code as string | null) ?? null, at: Number(r.at) } : null;
  }

  async record(row: Omit<DomainMemory, "at">): Promise<void> {
    if (!/^[a-z0-9.-]{3,253}$/.test(row.domain)) throw new Error("BROWSE_DOMAIN_INVALID: a domain is a lower-case hostname");
    this.sql("INSERT OR REPLACE INTO browse_domains (domain, engine, state, code, at) VALUES (?, ?, ?, ?, ?)", row.domain, row.engine, row.state, row.code, this.now());
  }

  /** Every remembered domain, for the person to see what their agent has learned. */
  all(): DomainMemory[] {
    return this.sql("SELECT domain, engine, state, code, at FROM browse_domains ORDER BY domain").map((r) => ({
      domain: String(r.domain),
      engine: (r.engine as Engine | null) ?? null,
      state: r.state === "blocked" ? "blocked" : "ok",
      code: (r.code as string | null) ?? null,
      at: Number(r.at),
    }));
  }
}
