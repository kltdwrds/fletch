// M12.2 semantic search, hermetic, with Ada and Bo of `solo-sam`: each person's memory and the
// company's fuse their FTS5 hits with the tenant's Vectorize index (a fake applying namespaces as the
// docs describe), embeddings through the model adapter on the fake model. Each store resolves the
// row ids the index proposes and applies its own gate, so a planted index that ignores namespaces,
// a semantic match outside the turn's readers, a forgotten line, a failing index and a refused
// embedding each hold or say what happened.
import { describe, expect, it } from "vitest";
import { homeKey, parseCitation } from "../../packages/agent/src/memory/home.ts";
import { MIN_SIMILARITY, namespaceOf } from "../../packages/agent/src/memory/semantic.ts";
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
  it("memory_search merges FTS5 and Vectorize hits, each tagged by how it was found, and every citation resolves, for Ada and Bo in their own namespaces", async () => {
    const w = world();
    await w.write(ada.email, "The budget deadline is Friday.");
    await w.write(ada.email, "The harbor keys hang by the door.");
    await w.write(other.email, "Bo walks the dog at noon.");
    expect(await w.sync(ada.email)).toEqual({ ok: true, upserted: 2, deleted: 0 });
    expect(await w.sync(other.email)).toEqual({ ok: true, upserted: 1, deleted: 0 });

    // Each person's vectors sit in their own namespace, ids naming the namespace and the row.
    const [nsAda, nsBo] = [await namespaceOf(ada.email), await namespaceOf(other.email)];
    expect(nsAda).not.toBe(nsBo);
    expect(w.index.inNamespace(nsAda)).toEqual([`${nsAda}:1`, `${nsAda}:2`]);
    expect(w.index.inNamespace(nsBo)).toEqual([`${nsBo}:1`]);

    // "spending cutoff" shares no word with the budget line: only the semantic half finds it.
    const { raw, text } = await w.search(ada.email, ["spending cutoff", "harbor keys"]);
    expect(raw.semantic).toBeUndefined();
    expect(raw.hits.map((h) => [h.text, h.match])).toEqual(
      expect.arrayContaining([
        ["The budget deadline is Friday.", "semantic"],
        ["The harbor keys hang by the door.", "both"],
      ]),
    );
    for (const h of raw.hits) {
      expect(await w.resolves(ada.email, h), h.citation).toBe(true);
      expect(text).toContain(h.citation);
    }
    // Keyword alone misses the paraphrase.
    expect(texts((await w.host(ada.email).memory.mem.search({ queries: ["spending cutoff"] }, ada.email) as { hits: SearchHit[] }).hits)).toEqual([]);

    // Bo's same question finds nothing of Ada's, by either half.
    const theirs = await w.search(other.email, ["spending cutoff", "harbor keys"]);
    expect(texts(theirs.raw.hits)).toEqual([]);
    expect(theirs.text).not.toContain("budget");
  });

  it("the planted fault: an index that ignores namespaces hands Bo Ada's vectors, and Bo's store resolves none of them", async () => {
    const w = world();
    await w.write(ada.email, "The budget deadline is Friday.");
    await w.write(other.email, "Bo walks the dog at noon.");
    await w.sync(ada.email);
    await w.sync(other.email);
    w.index.ignoreNamespace = true;
    // The index now returns Ada's row 1 for Bo's question; Bo's own row 1 is an unrelated line, and
    // without the namespace check on the id it would come back as a semantic hit.
    const near = await w.index.query((await import("../support/fake-embeddings.ts")).fakeEmbedding("spending cutoff"), { topK: 5, namespace: await namespaceOf(other.email) });
    expect(near.matches[0]).toMatchObject({ id: `${await namespaceOf(ada.email)}:1` });
    expect(near.matches[0]!.score).toBeGreaterThan(MIN_SIMILARITY);
    const { raw } = await w.search(other.email, ["spending cutoff", "money due"]);
    expect(raw.hits).toEqual([]);
  });

  it("the disclosure gate holds over semantic hits: a colleague's turn sees only the line both may read", async () => {
    const w = world();
    await w.write(ada.email, "The budget deadline is Friday.");
    await w.write(ada.email, "The money cutoff moved to Monday.", { audience: [ada.email, other.email] });
    await w.sync(ada.email);
    const own = await w.search(ada.email, ["money cutoff", "spending deadline"]);
    expect(texts(own.raw.hits).sort()).toEqual(["The budget deadline is Friday.", "The money cutoff moved to Monday."]);
    // The index proposes both lines for the turn that answers Bo; Ada's store shows only the shared one.
    const forBo = await w.search(ada.email, ["money cutoff", "spending deadline"], [other.email]);
    expect(texts(forBo.raw.hits)).toEqual(["The money cutoff moved to Monday."]);
    expect(forBo.text).not.toContain("Friday");
  });

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
    // A self-host deploy configures no AI Gateway, so the embedding call carries no gateway option.
    for (const r of w.fake.embeddingRequests) expect(r.options.gateway).toBeUndefined();
    const rows = (await w.ledger().modelCalls({ person: ada.email })).filter((r) => r.route === "embedding");
    expect(rows.map((r) => [r.model, r.status])).toEqual(Array.from({ length: 4 }, () => ["@cf/baai/bge-base-en-v1.5", "ok"]));
    expect(rows.every((r) => r.inputTokens > 0 && r.runId.startsWith("memory-index:"))).toBe(true);
  });

  it("company scope: a member's paraphrase finds the company line, and a team line stays with its team even when the index proposes it", async () => {
    const w = world();
    await w.company().createTeam(ada.email, { id: "finance", name: "finance" });
    await w.company().setTeamMember(ada.email, "finance", ada.email, true);
    expect((await w.http(ada.email, "POST", "/admin/memory", { scope: "company", text: "The offsite venue is the north barn." })).status).toBe(201);
    const team = await w.host(ada.email).memory.memoryWrite({ target: "team", team: "finance", text: "The supplier risk is high." }, { requester: ada.email, setting: personal, source: "chat:test", dedupe: "t1" });
    expect(team.ok).toBe(true);
    const ns = await namespaceOf("company");
    expect(w.index.inNamespace(ns)).toHaveLength(2);
    const adaSees = await w.search(ada.email, ["retreat location", "vendor hazard"]);
    expect(adaSees.raw.hits.map((h) => [h.text, h.scope]).sort()).toEqual([
      ["The offsite venue is the north barn.", "company"],
      ["The supplier risk is high.", "team:finance"],
    ]);
    // Company embeddings are the Company's Ledger rows, under its own name.
    expect((await w.ledger().modelCalls({ person: "company" })).filter((r) => r.route === "embedding").length).toBeGreaterThan(0);
  });

  it("offboarding's purge deletes the person's vectors, queued deletes included, and leaves Bo's", async () => {
    const w = world();
    const gone = await w.write(ada.email, "The budget deadline is Friday.", { claim: true });
    await w.write(ada.email, "The harbor keys hang by the door.");
    await w.write(other.email, "Bo walks the dog at noon.");
    await w.sync(ada.email);
    await w.sync(other.email);
    const plan = await w.host(ada.email).memory.forgetPlan({ claimIds: [gone.claimId as string] }, ada.email);
    if (!plan.ok) throw new Error(plan.code);
    await w.host(ada.email).memory.forgetConfirm(plan.planId, ada.email);
    const leg = w.host(ada.email).memory.semantic!;
    expect(leg.pending()).toBe(1);
    expect(await leg.purge(w.host(ada.email).memory.mem.chunkIds())).toEqual({ ok: true, vectors: 2 });
    expect(w.index.inNamespace(await namespaceOf(ada.email))).toEqual([]);
    expect(w.index.inNamespace(await namespaceOf(other.email))).toHaveLength(1);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
