// A fake Vectorize index for the hermetic lane (M12.2): the binding's upsert, deleteByIds and query
// over vectors held in memory, with namespaces applied before the search as the docs describe and
// cosine scores. Mutations are visible at once (the real index takes seconds). It records every
// call, can be told to fail, and can be planted to ignore namespaces, so a test shows the store's
// own check holds when the index does not.
export interface FakeVector {
  id: string;
  values: number[];
  namespace: string;
}

export class FakeVectorize {
  readonly vectors = new Map<string, FakeVector>();
  readonly calls: Array<{ op: "upsert" | "deleteByIds" | "query"; namespace?: string; ids?: string[] }> = [];
  /** When set, every call throws this message, as an unavailable index would. */
  fail: string | null = null;
  /** The planted fault: matches from every namespace. */
  ignoreNamespace = false;

  async upsert(vectors: FakeVector[]): Promise<{ mutationId: string }> {
    this.calls.push({ op: "upsert", ids: vectors.map((v) => v.id) });
    if (this.fail) throw new Error(this.fail);
    for (const v of vectors) this.vectors.set(v.id, { ...v, values: [...v.values] });
    return { mutationId: crypto.randomUUID() };
  }

  async deleteByIds(ids: string[]): Promise<{ mutationId: string }> {
    this.calls.push({ op: "deleteByIds", ids });
    if (this.fail) throw new Error(this.fail);
    for (const id of ids) this.vectors.delete(id);
    return { mutationId: crypto.randomUUID() };
  }

  async query(vector: number[], options: { topK: number; namespace: string }): Promise<{ matches: Array<{ id: string; score: number }>; count: number }> {
    this.calls.push({ op: "query", namespace: options.namespace });
    if (this.fail) throw new Error(this.fail);
    const matches = [...this.vectors.values()]
      .filter((v) => this.ignoreNamespace || v.namespace === options.namespace)
      .map((v) => ({ id: v.id, score: cosine(vector, v.values) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);
    return { matches, count: matches.length };
  }

  inNamespace(ns: string): string[] {
    return [...this.vectors.values()].filter((v) => v.namespace === ns).map((v) => v.id).sort();
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
