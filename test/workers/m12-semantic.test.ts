// M12.2 semantic search, hermetic, with Ada and Bo of `solo-sam`: each person's memory and the
// company's fuse their FTS5 hits with the tenant's Vectorize index (a fake applying namespaces as the
// docs describe), embeddings through the model adapter on the fake model. Each store resolves the
// row ids the index proposes and applies its own gate, so a planted index that ignores namespaces,
// a semantic match outside the turn's readers, a forgotten line, a failing index and a refused
// embedding each hold or say what happened.
import { describe, expect, it } from "vitest";
import { homeKey, parseCitation } from "../../packages/agent/src/memory/home.ts";
import { namespaceOf } from "../../packages/agent/src/memory/semantic.ts";
import type { SearchHit } from "../../packages/agent/src/memory/store.ts";
import { memoryTools } from "../../packages/agent/src/memory/tools.ts";
import { FakeVectorize } from "../support/fake-vectorize.ts";
import { seedClaim } from "./support/seed-claim.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const personal = { scope: "personal" as const };

function world() {
  const index = new FakeVectorize();
  const w = authorityWorld({ index });
  let n = 0;
  const write = async (who: string, text: string, extra: { audience?: string[]; claim?: boolean } = {}) => {
    const r = await w.host(who).memory.memoryWrite(
      { target: "daily", text },
      { requester: who, setting: { ...personal, ...(extra.audience ? { audience: extra.audience } : {}) }, source: "chat:test", dedupe: `w${n++}` },
    );
    if (!r.ok || !("citation" in r)) throw new Error(`write: ${JSON.stringify(r)}`);
    if (!extra.claim) return { ...r, claimId: undefined as string | undefined };
    const c = seedClaim(w.host(who).memory.mem, r, { kind: "fact" });
    if (!c.ok) throw new Error(`claim: ${c.code}`);
    return c;
  };
  const sync = async (who: string) => {
    const r = await w.host(who).memory.syncVectors();
    if (!r.ok) throw new Error(`sync: ${r.code}`);
    return r;
  };
  /** Through the `memory_search` tool, as a turn calls it, with the raw result beside its text. */
  const search = async (who: string, queries: string[], also: string[] = []) => {
    const tool = memoryTools({ api: w.host(who).memory, requester: who, also, setting: personal, source: "chat:test" })[0]!;
    const out = await tool.execute("call", { queries } as never);
    const raw = await w.host(who).memory.memorySearch({ queries }, who, also);
    if (!raw.ok) throw new Error(raw.code);
    return { text: out.content.map((c) => (c.type === "text" ? c.text : "")).join(""), raw };
  };
  /** A personal citation resolves when the rendered note's line holds the hit's text. */
  const resolves = async (owner: string, h: SearchHit) => {
    await w.host(owner).memory.renderPending();
    const at = parseCitation(h.citation)!;
    return (w.r2.text(homeKey(owner, at.path)) ?? "").split("\n")[at.line - 1]?.includes(h.text) ?? false;
  };
  return { ...w, index, write, sync, search, resolves };
}

const texts = (hits: SearchHit[]) => hits.map((h) => h.text);

describe("[M12.2] semantic search", () => {

  it("a forgotten line leaves the index and is never a hit, before and after the delete reaches it", async () => {
    const w = world();
    const gone = await w.write(ada.email, "The budget deadline is Friday.", { claim: true });
    await w.write(ada.email, "The harbor keys hang by the door.");
    await w.sync(ada.email);
    const ns = await namespaceOf(ada.email);
    const plan = await w.host(ada.email).memory.forgetPlan({ claimIds: [gone.claimId as string] }, ada.email);
    if (!plan.ok) throw new Error(plan.code);
    expect(await w.host(ada.email).memory.forgetConfirm(plan.planId, ada.email)).toMatchObject({ ok: true });
    // The vector is still in the index, queued for delete, and the store no longer has its row.
    expect(w.index.inNamespace(ns)).toContain(`${ns}:1`);
    expect(texts((await w.search(ada.email, ["spending cutoff", "money due"])).raw.hits)).toEqual([]);
    expect(await w.sync(ada.email)).toEqual({ ok: true, upserted: 0, deleted: 1 });
    expect(w.index.inNamespace(ns)).toEqual([`${ns}:2`]);
    expect(texts((await w.search(ada.email, ["spending cutoff", "money due"])).raw.hits)).toEqual([]);
  });

  it("every embedding goes through the adapter with collectLog false and is a Ledger row; a failed sync keeps the queue", async () => {
    const w = world();
    await w.write(ada.email, "The budget deadline is Friday.");
    await w.write(ada.email, "The harbor keys hang by the door.");
    w.index.fail = "VECTORIZE_UNAVAILABLE";
    expect(await w.host(ada.email).memory.syncVectors()).toMatchObject({ ok: false, code: "MEMORY_INDEX_UNAVAILABLE" });
    expect(w.host(ada.email).memory.semantic?.pending()).toBe(2);
    w.index.fail = null;
    expect(await w.sync(ada.email)).toEqual({ ok: true, upserted: 2, deleted: 0 });
    expect(w.host(ada.email).memory.semantic?.pending()).toBe(0);
    await w.search(ada.email, ["spending cutoff", "harbor keys"]);

    expect(w.fake.requests).toHaveLength(0);
    // The failed sync's batch, the sync's, and the tool's and the raw search's phrasings; the company
    // store is empty, so it embeds nothing.
    expect(w.fake.embeddingRequests.map((r) => r.texts.length)).toEqual([2, 2, 2, 2]);
    for (const r of w.fake.embeddingRequests) expect(r.options).toMatchObject({ gateway: { id: "qyvr", collectLog: false } });
    const rows = (await w.ledger().modelCalls({ person: ada.email })).filter((r) => r.route === "embedding");
    expect(rows.map((r) => [r.model, r.status])).toEqual(Array.from({ length: 4 }, () => ["@cf/baai/bge-base-en-v1.5", "ok"]));
    expect(rows.every((r) => r.inputTokens > 0 && r.runId.startsWith("memory-index:"))).toBe(true);
  });
});
