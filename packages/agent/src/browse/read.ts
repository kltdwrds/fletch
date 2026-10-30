// The read lane's ladder (M9, AD-9): Kitesurf first (free, light, stateless), Chromium Quick Action when
// Kitesurf cannot render the page, the live lane only by the person's or the model's explicit call.
// Escalation is for a page an engine could not render. A block is different: a bot wall, a rate limit
// or a refusal is the service's answer, so the domain's scope stops (B13), the memory says so, and no
// other engine, lane or identity is tried. A remembered block answers without a request.
import { BLOCK_TTL_MS, type Engine, type EngineMemoryApi } from "./memory.ts";
import { classify } from "./classify.ts";
import type { BrowserPort, ReadEngine } from "./port.ts";

export interface ReadDeps {
  port: BrowserPort;
  memory: EngineMemoryApi;
  now: () => number;
}

export type Stopped = { ok: false; stopped: true; code: string; reason: string; domain: string; remembered: boolean; retryAfter?: number };
export type Failed = { ok: false; stopped: false; code: "BROWSE_UNREACHABLE"; reason: string; domain: string; tried: Array<{ engine: Engine; reason: string }> };
export type Read = { ok: true; engine: ReadEngine; domain: string; status: number; markdown: string } | Stopped | Failed;

const STOP_NOTE = "Browsing this site is stopped here; nothing else was tried, and nothing should be tried another way. The person can open the page themselves.";

/** The stop a remembered block gives, or null when the domain is open. */
export async function rememberedStop(deps: Pick<ReadDeps, "memory" | "now">, domain: string): Promise<Stopped | null> {
  const mem = await deps.memory.get(domain);
  if (mem?.state !== "blocked" || deps.now() - mem.at >= BLOCK_TTL_MS) return null;
  return { ok: false, stopped: true, code: mem.code ?? "BROWSE_BOT_WALL", reason: `${domain} turned this browser away earlier. ${STOP_NOTE}`, domain, remembered: true };
}

export async function readPage(deps: ReadDeps, url: string): Promise<Read> {
  const domain = new URL(url).hostname.toLowerCase();
  const stop = await rememberedStop(deps, domain);
  if (stop) return stop;
  const mem = await deps.memory.get(domain);
  const order: ReadEngine[] = mem?.state === "ok" && mem.engine === "chromium" ? ["chromium"] : ["kitesurf", "chromium"];
  const tried: Array<{ engine: Engine; reason: string }> = [];
  for (const engine of order) {
    const r = await deps.port.read(url, engine);
    if (r.ok) {
      const block = classify(r.status, r.markdown);
      if (block) return blocked(deps, domain, engine, block.code, `${domain}: ${block.reason}.`, block.retryAfter);
      await deps.memory.record({ domain, engine, state: "ok", code: null });
      return { ok: true, engine, domain, status: r.status, markdown: r.markdown };
    }
    const block = classify(r.status, r.reason, r.retryAfter);
    if (block) return blocked(deps, domain, engine, block.code, `${domain}: ${block.reason}.`, block.retryAfter);
    tried.push({ engine, reason: `${r.status || "no status"}: ${r.reason}` });
  }
  return { ok: false, stopped: false, code: "BROWSE_UNREACHABLE", domain, tried, reason: `${domain} could not be read; tried ${tried.map((t) => `${t.engine} (${t.reason})`).join(", ")}.` };
}

export async function blocked(deps: Pick<ReadDeps, "memory">, domain: string, engine: Engine, code: string, why: string, retryAfter?: number): Promise<Stopped> {
  await deps.memory.record({ domain, engine, state: "blocked", code });
  // The wait is the site's own words, said so the person knows when it may be tried; it is never waited out here (B-P15-13).
  const wait = retryAfter ? ` It asked for ${retryAfter} seconds before another request.` : "";
  return { ok: false, stopped: true, code, reason: `${why}${wait} ${STOP_NOTE}`, domain, remembered: false, ...(retryAfter ? { retryAfter } : {}) };
}
