// A scripted browser for the hermetic lane (M9): the same `BrowserPort` the production binding
// implements, answering from fictional sites by hostname and recording every request that reached it,
// so a test can show what was NOT tried as well as what was. A site can hide behind a bot wall or a
// rate limit, refuse Kitesurf, or reflect what is typed into it (a hostile or careless page).
import type { BrowserPort, PageView, PortResult, ReadEngine, ReadResult } from "../../../packages/agent/src/browse/port.ts";

export interface FakeSite {
  markdown?: string;
  /** Kitesurf cannot render the page; Chromium can. */
  kitesurfUnsupported?: boolean;
  /** What every engine and lane is told: a challenge page, a 429 with Retry-After, or a 403. */
  wall?: "bot" | "rate" | "forbidden";
  page?: { title?: string; text: string; links?: Array<{ text: string; href: string }> };
  /** The page repeats what was typed into it, as a greeting would. */
  echoTyped?: boolean;
}

const CHALLENGE = "# Just a moment...\n\nVerify you are human to continue.";

export class FakeBrowser implements BrowserPort {
  readonly reads: Array<{ url: string; engine: ReadEngine }> = [];
  readonly gotos: Array<{ session: string; url: string | null }> = [];
  readonly handoffs: Array<{ session: string; instructions: string }> = [];
  readonly typed: Array<{ session: string; selector: string; value: string }> = [];
  readonly sessions: string[] = [];
  private readonly waiting = new Set<string>();
  private readonly at = new Map<string, string>();
  private readonly sites: Record<string, FakeSite>;

  constructor(sites: Record<string, FakeSite>) {
    this.sites = sites;
  }

  private site(url: string): FakeSite | undefined {
    return this.sites[new URL(url).hostname];
  }

  async read(url: string, engine: ReadEngine): Promise<ReadResult> {
    this.reads.push({ url, engine });
    const s = this.site(url);
    if (!s) return { ok: false, status: 404, reason: "no such site" };
    if (s.wall === "bot") return { ok: true, status: 200, markdown: CHALLENGE };
    if (s.wall === "rate") return { ok: false, status: 429, reason: "Too Many Requests", retryAfter: "30" };
    if (s.wall === "forbidden") return { ok: false, status: 403, reason: "Forbidden" };
    if (engine === "kitesurf" && s.kitesurfUnsupported) return { ok: false, status: 0, reason: "Kitesurf could not render this page" };
    return { ok: true, status: 200, markdown: s.markdown ?? s.page?.text ?? "" };
  }

  async session(known: string | null): Promise<PortResult<{ sessionId: string; reused: boolean }>> {
    if (known && this.sessions.includes(known)) return { ok: true, sessionId: known, reused: true };
    const id = `sess-${this.sessions.length + 1}`;
    this.sessions.push(id);
    return { ok: true, sessionId: id, reused: false };
  }

  async goto(session: string, url: string | null): Promise<PortResult<{ page: PageView }>> {
    this.gotos.push({ session, url });
    const target = url ?? this.at.get(session);
    if (!target) return { ok: false, code: "BROWSE_NO_PAGE", reason: "the session has no page" };
    this.at.set(session, target);
    const s = this.site(target);
    if (!s) return { ok: false, code: "BROWSE_NAVIGATION_FAILED", reason: "no such site" };
    if (s.wall === "bot") return { ok: true, page: { status: 200, url: target, title: "Just a moment...", text: CHALLENGE, links: [] } };
    if (s.wall === "rate") return { ok: true, page: { status: 429, url: target, title: "", text: "Too Many Requests", links: [] } };
    if (s.wall === "forbidden") return { ok: true, page: { status: 403, url: target, title: "", text: "Forbidden", links: [] } };
    const echoed = s.echoTyped ? `\nWelcome back, ${this.typed.filter((t) => t.session === session).map((t) => t.value).join(" ")}` : "";
    return { ok: true, page: { status: 200, url: target, title: s.page?.title ?? "", text: `${s.page?.text ?? ""}${echoed}`, links: s.page?.links ?? [] } };
  }

  async handoff(session: string, instructions: string): Promise<PortResult<{ liveViewUrl: string; expiresInMs: number; handoffId: string }>> {
    if (!this.sessions.includes(session)) return { ok: false, code: "BROWSE_NO_PAGE", reason: "no such session" };
    this.handoffs.push({ session, instructions });
    this.waiting.add(session);
    return { ok: true, liveViewUrl: `https://live.fixture.example/view/${session}-token`, expiresInMs: 300_000, handoffId: `handoff-${this.handoffs.length}` };
  }

  async handoffState(session: string): Promise<PortResult<{ active: boolean }>> {
    return { ok: true, active: this.waiting.has(session) };
  }

  async close(session: string): Promise<void> {
    this.waiting.delete(session);
  }

  /** The person finishes in the Live View; the page may now be past the wall. */
  completeHandoff(session: string, clearWall?: string): void {
    this.waiting.delete(session);
    if (clearWall) delete this.sites[clearWall]?.wall;
  }

  /** The Vault's injector: records what reached the page. */
  inject = async (session: string, selector: string, value: string): Promise<void> => {
    this.typed.push({ session, selector, value });
  };
}
