// The four memory tools (muse-reference section 5) over the `Person` object's memory. Every call
// names the person it is executed for; the store decides what that person may see. A write is
// reported as saved only after the store returned its citation, and a refusal carries its code.
// As registry specs they are observations, and `memory_write` carries `mutates` (M7.3), so the
// chat's gate refuses it while a colleague's request runs and a sub-agent's gate refuses it always.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { specsOf, type ToolSpec } from "../tools/registry.ts";
import type { HoistedName, StandingName } from "./home.ts";
import type { Refusal, SearchResult, Setting, Written } from "./store.ts";

export type MemoryWriteInput =
  | { target: "daily"; text: string }
  | { target: "team"; team: string; text: string }
  | { target: "memory"; sha256: string; edits: Array<{ op: "replace" | "insert" | "delete"; line: number; text?: string }> }
  | { target: "person"; name: string; relationship: string };

export interface WriteContext {
  requester: string;
  setting: Setting;
  source: string;
  dedupe: string;
  timeZone?: string;
  /**
   * The person's own words this turn (their latest typed message, a quote of the agent left out), set by the chat's
   * code and never by the model: a person page is written only for a name they wrote there (F44, delta 7).
   */
  said?: string;
}

/** A page of a file; `scope` names a company or team file, or a personal one read with other readers. */
export type GetResult = { ok: true; path: string; sha256: string; writer: string; scope?: string; total: number; lines: Array<{ n: number; text: string }>; next: number | null } | Refusal;
export type ExplainResult =
  | {
      ok: true;
      claim: { id: string; kind: string; status: string; quote: string; [k: string]: unknown };
      citation: string;
      sourceText: string | null;
      writer: string | null;
      learnedIn: { scope: string; source: string; audience: string[] | null };
      supersedes: string[];
      supersededBy: string[];
    }
  | Refusal;
/** A person page's write: the line it saved, cited, and the page it wrote (F44, delta 7). */
export type PersonWritten = Written & { page: string };
export type WriteResult = Written | PersonWritten | { ok: true; sha256: string; lines: number; citations: string[] } | (Refusal & { sha256?: string });

/**
 * What the chat reaches on the owner's `Person` object, over RPC in production. `also` names the other
 * readers of the turn (the colleague a request answers, and the request's origin): every store shows
 * only what the requester and each of them may read (the disclosure gate, M10.1).
 */
export interface MemoryApi {
  memorySearch(input: { queries: string[]; maxResults?: number }, requester: string, also?: string[]): Promise<SearchResult>;
  memoryGet(input: { path: string; from?: number; limit?: number }, requester: string, also?: string[]): Promise<GetResult>;
  memoryExplain(input: { claimId?: string; citation?: string }, requester: string, also?: string[]): Promise<ExplainResult>;
  memoryWrite(input: MemoryWriteInput, ctx: WriteContext): Promise<WriteResult>;
  standingFiles(): Promise<Array<{ name: StandingName | HoistedName; text: string; sha256: string }>>;
}

/** The turn the tools run in: who it is for and where the conversation happens. */
export interface MemoryToolContext {
  api: MemoryApi;
  requester: string;
  /** The turn's other readers; empty for the person's own task. */
  also?: string[];
  setting: Setting;
  source: string;
  timeZone?: string;
  /** The person's own words this turn, read by code (`WriteContext.said`); absent where no person typed (a job). */
  said?: () => string | undefined;
}

const text = (t: string, details: unknown = {}) => ({ content: [{ type: "text" as const, text: t }], details });
function unwrap<T extends { ok: boolean }>(r: T): Exclude<T, { ok: false }> {
  if (!r.ok) {
    const f = r as unknown as Refusal & { sha256?: string };
    throw new Error(`${f.code}: ${f.reason}${f.sha256 ? ` (current sha256 ${f.sha256})` : ""}`);
  }
  return r as Exclude<T, { ok: false }>;
}

const SearchParams = Type.Object({
  queries: Type.Array(Type.String({ minLength: 1 }), { minItems: 2, maxItems: 3, description: "Two or three different phrasings of what you are looking for." }),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
});
const GetParams = Type.Object({
  path: Type.String({ description: "A home path, such as memory/2026-10-12.md, MEMORY.md or memory/people/INDEX.md, or a company or team path a search cited, such as company/memory/2026-10-12.md." }),
  from: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
const ExplainParams = Type.Object({ claimId: Type.Optional(Type.String()), citation: Type.Optional(Type.String()) });
const WriteParams = Type.Union([
  Type.Object({ target: Type.Literal("daily"), text: Type.String({ minLength: 1 }) }),
  Type.Object({ target: Type.Literal("team"), team: Type.String({ description: "The id of a team the person belongs to." }), text: Type.String({ minLength: 1 }) }),
  Type.Object({
    target: Type.Literal("memory"),
    sha256: Type.String({ description: "The sha256 memory_get returned for MEMORY.md." }),
    edits: Type.Array(
      Type.Object({ op: Type.Union([Type.Literal("replace"), Type.Literal("insert"), Type.Literal("delete")]), line: Type.Integer({ minimum: 0 }), text: Type.Optional(Type.String()) }),
      { minItems: 1 },
    ),
  }),
  Type.Object({
    target: Type.Literal("person"),
    name: Type.String({ minLength: 1, description: "The person's name exactly as the person wrote it in their message, such as Ana Lima." }),
    relationship: Type.String({ minLength: 1, description: "What they are to the person, in a few words from the message, such as: sister-in-law; visits every summer." }),
  }),
]);

export function formatHits(r: Extract<SearchResult, { ok: true }>, queries: string[]): string {
  const lines = [`${r.hits.length} results for: ${queries.join(" | ")}`];
  if (r.semantic) lines.push(`Semantic search unavailable (${r.semantic.code}): these are keyword matches only.`);
  for (const h of r.hits) {
    const claims = h.claims.map((c) => `claim ${c.id} ${c.kind} ${c.status}`).join(", ");
    lines.push(`${h.citation} (${h.uri})${claims ? ` [${claims}]` : ""} scope ${h.scope}`, `  ${h.text}`);
    if (h.marker) lines.push(`  ${h.marker}`);
  }
  if (r.more) lines.push(`More: ${r.more} further results; narrow the phrasing or raise maxResults.`);
  return lines.join("\n");
}

export function memoryTools(c: MemoryToolContext): AgentTool<never>[] {
  const search: AgentTool<typeof SearchParams> = {
    name: "memory_search",
    label: "Search memory",
    description:
      "Search memory before asserting anything about prior work, decisions, dates or people: the person's own, their teams' and the company's, each result tagged with its scope. Cite each result you use exactly as its heading gives it, a path, #L and a line number, for example company/memory/2026-10-12.md#L3.",
    parameters: SearchParams,
    execute: async (_id, p) => {
      const r = unwrap(await c.api.memorySearch(p, c.requester, c.also));
      return text(formatHits(r, p.queries), { citations: r.hits.map((h) => h.citation) });
    },
  };
  const get: AgentTool<typeof GetParams> = {
    name: "memory_get",
    label: "Read memory file",
    description: "Read a memory file in pages of numbered lines. MEMORY.md comes with the sha256 an edit must quote.",
    parameters: GetParams,
    execute: async (_id, p) => {
      const r = unwrap(await c.api.memoryGet(p, c.requester, c.also));
      const head = `${r.path}${r.scope ? ` [${r.scope}]` : ""} sha256 ${r.sha256}, lines ${r.lines[0]?.n ?? 0}-${r.lines.at(-1)?.n ?? 0} of ${r.total}${r.next ? `; next page from ${r.next}` : ""}`;
      return text([head, ...r.lines.map((l) => `${l.n}: ${l.text}`)].join("\n"), { next: r.next });
    },
  };
  const explain: AgentTool<typeof ExplainParams> = {
    name: "memory_explain",
    label: "Explain a memory",
    description: "Show where a claim came from: its source line, setting, and what it replaced or what replaced it.",
    parameters: ExplainParams,
    execute: async (_id, p) => text(JSON.stringify(unwrap(await c.api.memoryExplain(p, c.requester, c.also)), null, 1)),
  };
  const write: AgentTool<typeof WriteParams> = {
    name: "memory_write",
    label: "Save to memory",
    description:
      "Save a durable fact, preference or decision as a line in today's note (target daily; the hourly upkeep turns lines into claims): a new fact goes there. A fact a team of the person's shares is target team. Edit MEMORY.md by line against the sha256 you read (target memory) only when the person asks to change what it says. When the person states their relationship with someone they name, target person saves that line and writes the person's page (memory/people/<name>.md). Say it is saved only after this returns, with the citation it returned.",
    parameters: WriteParams,
    execute: async (id, p) => {
      const said = c.said?.();
      const r = unwrap(await c.api.memoryWrite(p as MemoryWriteInput, { requester: c.requester, setting: c.setting, source: c.source, dedupe: id, timeZone: c.timeZone, ...(said === undefined ? {} : { said }) }));
      if ("page" in r) return text(`saved ${r.citation}; wrote the person page ${r.page}`, r);
      if ("citation" in r) return text(`saved ${r.citation}`, r);
      // Each line the edit wrote, cited, so a reply quotes the citation the tool returned (F44, delta 1).
      return text(`saved MEMORY.md, now ${r.lines} lines, sha256 ${r.sha256}${r.citations.length ? `; wrote ${r.citations.join(", ")}` : ""}`, r);
    },
  };
  return [search, get, explain, write] as unknown as AgentTool<never>[];
}

/** The memory tools that change the person's memory; their specs carry `mutates`. */
export const MEMORY_WRITES: ReadonlySet<string> = new Set(["memory_write"]);

/** The memory tools as registry specs: observations, the writes among them marked `mutates`. */
export function memorySpecs(c: MemoryToolContext): ToolSpec[] {
  return specsOf(memoryTools(c), "observation").map((t) => (MEMORY_WRITES.has(t.name) ? { ...t, mutates: true } : t));
}
