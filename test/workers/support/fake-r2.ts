// An in-memory R2 bucket for the hermetic lane: the calls the agent makes (get, put with custom
// metadata and an `etagMatches` precondition, head, delete, list by prefix), each version with a
// fresh etag, so a stale conditional put fails exactly as R2's does, by returning null.
interface Stored {
  body: string;
  /** The bytes as written (M24.3: a rendered document); `body` is then their text decoding, for assertions. */
  raw?: Uint8Array;
  etag: string;
  customMetadata: Record<string, string>;
  httpMetadata: Record<string, string>;
}

export class FakeR2 {
  readonly objects = new Map<string, Stored>();
  private version = 0;
  /** Every key put, in order; tests read writes back from it. */
  readonly puts: string[] = [];

  private view(key: string, s: Stored) {
    const bytes = () => s.raw ?? new TextEncoder().encode(s.body);
    return {
      key, etag: s.etag, size: bytes().byteLength, customMetadata: s.customMetadata, httpMetadata: s.httpMetadata,
      text: async () => s.body,
      arrayBuffer: async () => bytes().slice().buffer,
    };
  }

  async get(key: string) {
    const s = this.objects.get(key);
    return s ? this.view(key, s) : null;
  }

  async head(key: string) {
    return this.get(key);
  }

  async put(key: string, value: string | Uint8Array, opts: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string } } = {}) {
    const current = this.objects.get(key);
    if (opts.onlyIf?.etagMatches !== undefined && current?.etag !== opts.onlyIf.etagMatches) return null;
    const stored: Stored = { ...(typeof value === "string" ? { body: value } : { body: new TextDecoder().decode(value), raw: value.slice() }), etag: `v${++this.version}`, customMetadata: { ...(opts.customMetadata ?? {}) }, httpMetadata: { ...(opts.httpMetadata ?? {}) } };
    this.objects.set(key, stored);
    this.puts.push(key);
    return this.view(key, stored);
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(opts: { prefix?: string } = {}) {
    const objects = [...this.objects.entries()].filter(([k]) => k.startsWith(opts.prefix ?? "")).map(([k, s]) => this.view(k, s));
    return { objects, truncated: false };
  }

  /** The text of a key, for assertions. */
  text(key: string): string | undefined {
    return this.objects.get(key)?.body;
  }

  /** The bytes of a key, for assertions on a binary document (M24.3). */
  bytes(key: string): Uint8Array | undefined {
    const s = this.objects.get(key);
    return s ? (s.raw ?? new TextEncoder().encode(s.body)) : undefined;
  }

  meta(key: string): Record<string, string> | undefined {
    return this.objects.get(key)?.customMetadata;
  }

  /** Replaces a key's body behind the agent's back, as another writer would. */
  tamper(key: string, body: string): void {
    const s = this.objects.get(key);
    if (s) this.objects.set(key, { body, etag: `v${++this.version}`, customMetadata: s.customMetadata, httpMetadata: s.httpMetadata });
  }
}

export const asBucket = (r2: FakeR2) => r2 as unknown as R2Bucket;
