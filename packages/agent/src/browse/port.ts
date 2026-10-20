// The browser as the tools see it (M9). The production port is the Worker's `browser` binding:
// Quick Actions (Kitesurf first, Chromium after) for the read lane and a reused Chromium session for
// the live lane. Tests supply a fake with the same shape, so the ladder, the block handling and the
// handoff run hermetically and the staging lane runs the same code against Browser Run.
import type { Engine } from "./memory.ts";

export type ReadEngine = Exclude<Engine, "live">;

export type ReadResult =
  | { ok: true; status: number; markdown: string }
  | { ok: false; status: number; reason: string; retryAfter?: string | null };

export interface PageView {
  status: number;
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}

export type PortResult<T> = ({ ok: true } & T) | { ok: false; code: string; reason: string };

export interface BrowserPort {
  /** One Quick Action markdown read on the named engine. */
  read(url: string, engine: ReadEngine): Promise<ReadResult>;
  /** The session to reuse, or a new one; `known` is the id this chat held. */
  session(known: string | null): Promise<PortResult<{ sessionId: string; reused: boolean }>>;
  /** Navigates the session to `url` (or re-reads the current page when `url` is null). */
  goto(sessionId: string, url: string | null): Promise<PortResult<{ page: PageView }>>;
  /** A Live View URL for the session's page and the handoff request that asks a person to act. */
  handoff(sessionId: string, instructions: string): Promise<PortResult<{ liveViewUrl: string; expiresInMs: number; handoffId: string }>>;
  /** Whether a requested handoff is still waiting for the person. */
  handoffState(sessionId: string): Promise<PortResult<{ active: boolean }>>;
  close(sessionId: string): Promise<void>;
}
