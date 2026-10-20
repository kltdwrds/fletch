// Semantic memory search (M12.2): bge-base embeddings in the tenant's Vectorize index beside each
// store's FTS5 index. A store (a person's `Person`, or the `Company` for company and team scope) has
// its own namespace in the index; a vector's id is that namespace and the store's row id, so a match
// is only ever a row id of the store that asked, and the store resolves it and applies its own gate
// on every call. The index only proposes rows: what is shown is decided where the row lives.
//
// Writes are queued in the store's SQLite with the row they index and sent to Vectorize later in
// batches (Vectorize applies mutations asynchronously anyway); a deleted row queues its vector's
// delete, and a match whose row is gone resolves to nothing. A search whose semantic half fails
// returns the keyword half and says so, never as a complete answer.
import type { LedgerSink } from "../ledger/types.ts";
import { embed } from "../model/adapter.ts";
import type { ModelConfig } from "../model/routes.ts";
import { sha256Hex } from "./home.ts";
import type { Refusal } from "./store.ts";

// Local, so this module has no runtime import of the store, which imports it.
const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

export const VECTOR_QUEUE_SCHEMA = "CREATE TABLE IF NOT EXISTS vector_queue (row_id INTEGER PRIMARY KEY, op TEXT NOT NULL);";

/** Matches asked of the index per phrasing. */
export const SEMANTIC_TOP_K = 20;
/**
 * A semantic match below this cosine similarity is not a hit, so the leg does not always fill up.
 * Measured on staging (DECISIONS-LOG, M12.2): under bge-base with `cls` pooling, a paraphrased
 * question scores 0.49 to 0.68 against its fact (median 0.59) and unrelated sentences at most 0.43.
 */
export const MIN_SIMILARITY = 0.5;
/** Reciprocal rank fusion's constant (Cormack et al.): each list adds 1 / (k + rank). */
export const RRF_K = 60;
/** Rows one sync embeds and sends at most; the rest wait for the next. */
export const SYNC_BATCH = 50;
/** Vector ids one delete carries in a purge (the binding takes up to 1000 per mutation). */
export const PURGE_BATCH = 1000;

/** The part of `VectorizeIndex` the leg uses; the binding in production, a fake in tests. */
export interface VectorIndex {
  upsert(vectors: Array<{ id: string; values: number[]; namespace: string }>): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(vector: number[], options: { topK: number; namespace: string }): Promise<{ matches: Array<{ id: string; score: number }> }>;
}

export type Embedder = (texts: string[]) => Promise<{ ok: true; vectors: number[][] } | Refusal>;

/** How a hit was found: by the keyword index, the semantic index, or both. */
export type Match = "keyword" | "semantic" | "both";
/** Said beside the hits when the semantic half failed: they are keyword matches only. */
export type SemanticDegraded = { code: string; reason: string };

/** A store's namespace: a hash of its key (a person's email, or `company`), within 64 bytes. */
export async function namespaceOf(store: string): Promise<string> {
  return `s${(await sha256Hex(store)).slice(0, 40)}`;
}

/**
 * Reciprocal rank fusion of the keyword ranking and the semantic ranking, each a list of row ids best
 * first: neither index's scores compare with the other's, so only ranks are used. Ties keep the
 * keyword order, then the semantic order.
 */
export function fuse(keyword: readonly number[], semantic: readonly number[]): Array<{ id: number; match: Match }> {
  const score = new Map<number, { s: number; order: number; k: boolean; v: boolean }>();
  const add = (ids: readonly number[], which: "k" | "v") =>
    ids.forEach((id, i) => {
      const at = score.get(id) ?? { s: 0, order: score.size, k: false, v: false };
      at.s += 1 / (RRF_K + i + 1);
      at[which] = true;
      score.set(id, at);
    });
  add(keyword, "k");
  add(semantic, "v");
  return [...score.entries()]
    .sort(([, a], [, b]) => b.s - a.s || a.order - b.order)
    .map(([id, a]) => ({ id, match: a.k && a.v ? "both" : a.k ? "keyword" : "semantic" }));
}

export class SemanticLeg {
  private readonly sql: () => SqlStorage;
  private readonly index: VectorIndex;
  private readonly embed: Embedder;
  private readonly store: string;
  private ns: string | undefined;

  constructor(deps: { sql: () => SqlStorage; index: VectorIndex; embed: Embedder; store: string }) {
    this.sql = deps.sql;
    this.index = deps.index;
    this.embed = deps.embed;
    this.store = deps.store;
  }

  async namespace(): Promise<string> {
    this.ns ??= await namespaceOf(this.store);
    return this.ns;
  }

  /** Row ids waiting to reach the index. */
  pending(): number {
    return this.sql().exec<{ n: number }>("SELECT COUNT(*) AS n FROM vector_queue").one().n;
  }

  /**
   * Embeds and upserts a batch of queued rows and sends queued deletes. `texts` gives each row id's
   * current text, leaving out rows that are gone (their vector is deleted instead). A failure leaves
   * the queue as it was, to be retried by the next sync.
   */
  async sync(texts: (ids: number[]) => Map<number, string>): Promise<{ ok: true; upserted: number; deleted: number } | Refusal> {
    const queued = this.sql().exec<{ row_id: number; op: string }>("SELECT row_id, op FROM vector_queue ORDER BY row_id LIMIT ?", SYNC_BATCH).toArray();
    if (!queued.length) return { ok: true, upserted: 0, deleted: 0 };
    const ns = await this.namespace();
    const live = texts(queued.filter((q) => q.op === "upsert").map((q) => q.row_id));
    const up = queued.filter((q) => q.op === "upsert" && live.has(q.row_id)).map((q) => q.row_id);
    const del = queued.filter((q) => !up.includes(q.row_id)).map((q) => q.row_id);
    try {
      if (up.length) {
        const vectors = await this.embed(up.map((id) => live.get(id) as string));
        if (!vectors.ok) return vectors;
        await this.index.upsert(up.map((id, i) => ({ id: `${ns}:${id}`, values: vectors.vectors[i] as number[], namespace: ns })));
      }
      if (del.length) await this.index.deleteByIds(del.map((id) => `${ns}:${id}`));
    } catch (err) {
      return refuse("MEMORY_INDEX_UNAVAILABLE", String(err));
    }
    const done = queued.map((q) => q.row_id);
    this.sql().exec(`DELETE FROM vector_queue WHERE row_id IN (${done.map(() => "?").join(", ")})`, ...done);
    return { ok: true, upserted: up.length, deleted: del.length };
  }

  /**
   * Deletes every vector of the store before its storage is emptied (offboarding, M11): `ids` are its
   * live rows, and queued rows are added, so a delete not yet sent is not lost with the queue.
   */
  async purge(ids: readonly number[]): Promise<{ ok: true; vectors: number } | Refusal> {
    const queued = this.sql().exec<{ row_id: number }>("SELECT row_id FROM vector_queue").toArray().map((r) => r.row_id);
    const all = [...new Set([...ids, ...queued])];
    const ns = await this.namespace();
    try {
      for (let i = 0; i < all.length; i += PURGE_BATCH) await this.index.deleteByIds(all.slice(i, i + PURGE_BATCH).map((id) => `${ns}:${id}`));
    } catch (err) {
      return refuse("MEMORY_INDEX_UNAVAILABLE", String(err));
    }
    return { ok: true, vectors: all.length };
  }

  /**
   * The store's row ids nearest the phrasings, best first, at or above the similarity floor. A match
   * outside this store's namespace is dropped whatever the index returned: the store resolves only its
   * own ids.
   */
  async recall(queries: string[]): Promise<{ ok: true; ids: number[] } | Refusal> {
    const vectors = await this.embed(queries);
    if (!vectors.ok) return vectors;
    const ns = await this.namespace();
    const best = new Map<number, number>();
    try {
      for (const v of vectors.vectors) {
        const { matches } = await this.index.query(v, { topK: SEMANTIC_TOP_K, namespace: ns });
        for (const m of matches) {
          const id = rowIdOf(m.id, ns);
          if (id === null || m.score < MIN_SIMILARITY) continue;
          if ((best.get(id) ?? -1) < m.score) best.set(id, m.score);
        }
      }
    } catch (err) {
      return refuse("MEMORY_INDEX_UNAVAILABLE", String(err));
    }
    return { ok: true, ids: [...best.entries()].sort(([a, x], [b, y]) => y - x || a - b).map(([id]) => id) };
  }
}

/** The row id a vector id names, only when it is in namespace `ns`. */
export function rowIdOf(vectorId: string, ns: string): number | null {
  const m = /^([^:]+):(\d{1,18})$/.exec(vectorId);
  return m && m[1] === ns ? Number(m[2]) : null;
}

/** Queues a row's vector for upsert or delete; called inside the store's own write. */
export function enqueueVector(sql: SqlStorage, rowId: number, op: "upsert" | "delete"): void {
  sql.exec("INSERT INTO vector_queue (row_id, op) VALUES (?, ?) ON CONFLICT (row_id) DO UPDATE SET op = excluded.op", rowId, op);
}

/**
 * The leg as the `Person` and the `Company` build it: the tenant's index, embeddings through the
 * model adapter under the store's name in the Ledger, and the store's own SQLite. No index bound, no
 * leg: search is keyword only.
 */
export function legFor(d: { index: unknown; ai: Ai; models?: ModelConfig; ledger: LedgerSink; tenant: string; store: string; sql: () => SqlStorage; now: () => number }): SemanticLeg | undefined {
  if (!d.index) return undefined;
  return new SemanticLeg({
    sql: d.sql,
    index: d.index as VectorIndex,
    embed: (texts) => embed({ ai: d.ai, ledger: d.ledger, now: d.now, models: d.models }, { tenant: d.tenant, person: d.store, runId: `memory-index:${crypto.randomUUID()}` }, texts),
    store: d.store,
  });
}
