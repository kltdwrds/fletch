// Deterministic stand-in embeddings for the fake model (M12.2): a text becomes a bag of concepts, each
// word mapped through a synonym table to its concept, every concept hashed to three of 768 dimensions,
// then normalised. Texts sharing concepts score high under cosine and texts sharing none score 0, so
// a paraphrase with no word in common is found by the semantic half and never by the keyword half.
import { createHash } from "node:crypto";

export const FAKE_EMBEDDING_DIMENSIONS = 768;

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was what when where which who will with s".split(" "));

/** Word to concept: each group's first word names the concept. */
export const SYNONYMS: string[][] = [
  ["budget", "spending", "money", "funds"],
  ["deadline", "cutoff", "due"],
  ["offsite", "retreat"],
  ["hiring", "recruiting", "recruitment"],
  ["roadmap", "plan"],
  ["vendor", "supplier"],
  ["audit", "review"],
  ["launch", "release"],
  ["pricing", "prices"],
  ["security", "safety"],
  ["onboarding", "induction"],
  ["owner", "responsible", "lead"],
  ["venue", "location", "place"],
  ["risk", "danger", "hazard"],
  ["approval", "signoff", "permission"],
  ["keys", "key"],
];
const CONCEPT = new Map(SYNONYMS.flatMap((g) => g.map((w) => [w, g[0] as string] as const)));

export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(FAKE_EMBEDDING_DIMENSIONS).fill(0);
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  for (const w of new Set(words.map((w) => CONCEPT.get(w) ?? w))) {
    const h = createHash("sha256").update(w).digest();
    for (let i = 0; i < 3; i++) v[h.readUInt16BE(i * 2) % FAKE_EMBEDDING_DIMENSIONS] += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
