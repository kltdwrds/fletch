// The staging search probe of M12.2's live lane, kept out of `objects/person.ts`: the person's own
// search, keyword only or fused, with each hit's citation resolved against the note. With `waitFor`,
// the search repeats for up to `waitMs` until that text is a semantic match, since Vectorize applies
// writes seconds later; a wait that ends without it says so.
import type { SemanticLeg } from "./semantic.ts";
import type { PersonMemory } from "./store.ts";

export async function probeSearch(mem: PersonMemory, leg: SemanticLeg | undefined, person: string, q: { queries: string[]; mode: "keyword" | "hybrid"; waitFor?: string }, waitMs: number) {
  if (q.mode === "hybrid" && !leg) return { ok: false as const, code: "MEMORY_INDEX_UNBOUND", reason: "this script has no MEMORY_INDEX binding" };
  const input = { queries: q.queries, maxResults: 5 };
  const run = () => (q.mode === "hybrid" && leg ? mem.searchHybrid(input, person, leg) : Promise.resolve(mem.search(input, person)));
  const seen = (r: Awaited<ReturnType<typeof run>>) => r.ok && r.hits.some((h) => h.text === q.waitFor && h.match !== "keyword");
  const deadline = Date.now() + waitMs;
  let r = await run();
  while (q.waitFor && r.ok && !seen(r) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2_000));
    r = await run();
  }
  if (!r.ok) return r;
  const hits = [];
  for (const h of r.hits) {
    const page = await mem.get({ path: h.path, from: h.line, limit: 1 }, person);
    hits.push({ citation: h.citation, text: h.text, match: h.match ?? "keyword", resolves: page.ok && (page.lines[0]?.text ?? "").includes(h.text) });
  }
  return { ok: true as const, mode: q.mode, hits, ...(q.waitFor ? { visible: seen(r) } : {}), ...(r.semantic ? { semantic: r.semantic } : {}) };
}
