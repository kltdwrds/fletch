// What a turn's context carries from beyond the person (M10.1, AD-6): the company's instructions,
// fenced below the person's standing files, and for a colleague's request the memory the disclosure
// gate passes for everyone the turn answers. The stores decide; this only asks them with the turn's
// readers and keeps the answer for the turn, so the prefix holds still across its steps.
import type { MemoryApi } from "../memory/tools.ts";
import type { TurnContext } from "./gate.ts";

/**
 * Who else a turn's memory reads answer to: nobody for the person's own task; for a colleague's
 * request, the colleague who sent it and the principal who started the chain.
 */
export function otherReaders(context: TurnContext, person: string): string[] {
  if (context.counterpart.kind === "own-agent" && context.hops === 0) return [];
  const others = [context.counterpart.kind === "own-agent" ? null : context.counterpart.id, context.origin];
  return [...new Set(others.filter((e): e is string => !!e && e !== person))];
}

export interface SharedDeps {
  company: (() => Promise<{ tenant: string; text: string } | null>) | undefined;
  memory: MemoryApi | undefined;
  meta(key: string): string | null | undefined;
  keep(key: string, value: string): void;
  context: TurnContext;
  turnId: string;
  person: string;
}

export type Shared = { ok: true; company?: { tenant: string; text: string }; memory: string[] } | { ok: false; code: string; detail: string };

const detail = (err: unknown) => String(err instanceof Error ? err.message : err);

/** A store that cannot answer fails the turn with its code; it is never shown as empty. */
export async function sharedContext(d: SharedDeps): Promise<Shared> {
  let company: { tenant: string; text: string } | null = null;
  try {
    company = (await d.company?.()) ?? null;
  } catch (err) {
    return { ok: false, code: "COMPANY_UNAVAILABLE", detail: detail(err) };
  }
  const base = company?.text.trim() ? { company } : {};
  const text = d.meta(`requestText:${d.turnId}`);
  if (!text || !d.memory) return { ok: true, ...base, memory: [] };
  const kept = d.meta(`disclosed:${d.turnId}`);
  if (kept) return { ok: true, ...base, memory: JSON.parse(kept) as string[] };
  try {
    const found = await d.memory.memorySearch({ queries: [text], maxResults: 8 }, d.person, otherReaders(d.context, d.person));
    if (!found.ok) return { ok: false, code: "MEMORY_UNAVAILABLE", detail: found.code };
    const lines = found.hits.map((h) => `[${h.scope}] ${h.text} (${h.citation})`);
    d.keep(`disclosed:${d.turnId}`, JSON.stringify(lines));
    return { ok: true, ...base, memory: lines };
  } catch (err) {
    return { ok: false, code: "MEMORY_UNAVAILABLE", detail: detail(err) };
  }
}
