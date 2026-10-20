// The production browser port (M9): the Worker's `browser` binding (Browser Run). The read lane is a
// Quick Action `markdown` call, on Kitesurf when asked; the live lane acquires a Chromium session,
// keeps it alive between turns and reconnects to it by id (reuse) over CDP; the handoff asks Browser
// Run for a tab-mode Live View URL and raises `Cloudflare.handoff` so a person can act in the page.
// Facts from developers.cloudflare.com/browser-run (binding API, Kitesurf, human-in-the-loop, Oct 2026).
import type { BrowserPort, PageView, PortResult, ReadEngine, ReadResult } from "./port.ts";

/** The parts of the binding this port uses; the binding itself is typed `Fetcher` by wrangler. */
export interface BrowserBinding {
  quickAction(name: string, options: Record<string, unknown>): Promise<Response>;
  acquire(options?: Record<string, unknown>): Promise<{ sessionId: string }>;
  connectSession(sessionId: string, options?: Record<string, unknown>): Promise<{ webSocket: Fetcher }>;
  getSession(sessionId: string): Promise<unknown | null>;
  closeSession(sessionId: string): Promise<unknown>;
  getLiveView(sessionId: string, options?: Record<string, unknown>): Promise<{ devtoolsFrontendUrl?: string; url?: string }>;
  devtools: { listTargets(sessionId: string, options?: Record<string, unknown>): Promise<Array<{ id: string; type: string; url?: string }>> };
}

const KEEP_ALIVE_MS = 10 * 60 * 1000;
const LIVE_VIEW_MS = 5 * 60 * 1000;
const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000;
const CDP_TIMEOUT_MS = 30_000;
const TEXT_MAX = 60_000;
const LINKS_MAX = 300;

const fail = (code: string, err: unknown): { ok: false; code: string; reason: string } => ({ ok: false, code, reason: String(err instanceof Error ? err.message : err).slice(0, 300) });

type Send = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<Record<string, unknown>>;

/** Opens a CDP socket to a session for the length of `run`, and closes it after. */
async function withCdp<T>(b: BrowserBinding, sessionId: string, run: (send: Send, events: (method: string, ms: number) => Promise<void>) => Promise<T>): Promise<T> {
  const conn = await b.connectSession(sessionId);
  const response = await conn.webSocket.fetch("https://browser-binding.invalid", { headers: { Upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error("BROWSER_NO_SOCKET: Browser Run did not return a WebSocket");
  socket.accept();
  let next = 0;
  const waiters = new Map<string, Array<() => void>>();
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(String(event.data)) as { id?: number; method?: string; result?: Record<string, unknown>; error?: { message: string } };
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p?.reject(new Error(m.error.message));
      else p?.resolve(m.result ?? {});
    } else if (m.method) {
      for (const w of waiters.get(m.method) ?? []) w();
      waiters.delete(m.method);
    }
  });
  socket.addEventListener("close", () => {
    for (const p of pending.values()) p.reject(new Error("BROWSER_SOCKET_CLOSED: the CDP connection closed before the command completed"));
    pending.clear();
  });
  const send: Send = (method, params = {}, sid) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`BROWSER_CDP_TIMEOUT: ${method} timed out`));
      }, CDP_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
  const event = (method: string, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`BROWSER_CDP_TIMEOUT: no ${method} within ${ms} ms`)), ms);
      waiters.set(method, [...(waiters.get(method) ?? []), () => {
        clearTimeout(timer);
        resolve();
      }]);
    });
  try {
    return await run(send, event);
  } finally {
    socket.close();
  }
}

/** Attaches to the session's first page target and returns the flat session id commands carry. */
async function attach(send: Send): Promise<string> {
  const targets = (await send("Target.getTargets")) as { targetInfos?: Array<{ targetId: string; type: string }> };
  const page = targets.targetInfos?.find((t) => t.type === "page");
  if (!page) throw new Error("BROWSER_NO_PAGE: the session has no page");
  const attached = (await send("Target.attachToTarget", { targetId: page.targetId, flatten: true })) as { sessionId?: string };
  if (!attached.sessionId) throw new Error("BROWSER_NO_PAGE: the page could not be attached");
  return attached.sessionId;
}

const READ_PAGE = `JSON.stringify({
  status: (performance.getEntriesByType('navigation')[0] || {}).responseStatus || 0,
  url: location.href,
  title: document.title,
  text: (document.body ? document.body.innerText : '').slice(0, ${TEXT_MAX}),
  links: [...document.querySelectorAll('a[href]')].slice(0, ${LINKS_MAX}).map(a => ({ text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 120), href: a.href }))
})`;

async function readPage(send: Send, sid: string): Promise<PageView> {
  const r = (await send("Runtime.evaluate", { expression: READ_PAGE, returnByValue: true }, sid)) as { result?: { value?: string } };
  return JSON.parse(String(r.result?.value ?? "null")) as PageView;
}

export function bindingPort(binding: BrowserBinding): BrowserPort {
  return {
    async read(url, engine: ReadEngine): Promise<ReadResult> {
      let response: Response;
      try {
        response = await binding.quickAction("markdown", { url, ...(engine === "kitesurf" ? { browser: "kitesurf" } : {}) });
      } catch (err) {
        return { ok: false, status: 0, reason: String(err instanceof Error ? err.message : err).slice(0, 300) };
      }
      const body = await response.text();
      if (!response.ok) return { ok: false, status: response.status, reason: body.slice(0, 300), retryAfter: response.headers.get("retry-after") };
      try {
        const j = JSON.parse(body) as { success?: boolean; result?: unknown; errors?: Array<{ message?: string }> };
        if (j.success === false || typeof j.result !== "string") return { ok: false, status: response.status, reason: String(j.errors?.[0]?.message ?? "Browser Run returned no markdown").slice(0, 300) };
        return { ok: true, status: response.status, markdown: j.result };
      } catch {
        return { ok: false, status: response.status, reason: "Browser Run's answer was not JSON" };
      }
    },

    async session(known): Promise<PortResult<{ sessionId: string; reused: boolean }>> {
      try {
        if (known && (await binding.getSession(known))) return { ok: true, sessionId: known, reused: true };
        const s = await binding.acquire({ keepAlive: KEEP_ALIVE_MS });
        return { ok: true, sessionId: s.sessionId, reused: false };
      } catch (err) {
        return fail("BROWSE_SESSION_FAILED", err);
      }
    },

    async goto(sessionId, url): Promise<PortResult<{ page: PageView }>> {
      try {
        const page = await withCdp(binding, sessionId, async (send, event) => {
          const sid = await attach(send);
          if (url !== null) {
            await send("Page.enable", {}, sid);
            const loaded = event("Page.loadEventFired", CDP_TIMEOUT_MS);
            const nav = (await send("Page.navigate", { url }, sid)) as { errorText?: string };
            if (nav.errorText) throw new Error(`BROWSE_NAVIGATION_FAILED: ${nav.errorText}`);
            await loaded;
          }
          return readPage(send, sid);
        });
        return { ok: true, page };
      } catch (err) {
        return fail(String(err instanceof Error ? err.message : err).split(": ")[0] || "BROWSE_SESSION_FAILED", err);
      }
    },

    async handoff(sessionId, instructions) {
      try {
        const targets = await binding.devtools.listTargets(sessionId);
        const page = targets.find((t) => t.type === "page");
        if (!page) return { ok: false, code: "BROWSE_NO_PAGE", reason: "the session has no page to hand over" };
        const view = await binding.getLiveView(sessionId, { targetId: page.id, mode: "tab", expiresInMs: LIVE_VIEW_MS });
        const liveViewUrl = view.devtoolsFrontendUrl ?? view.url;
        if (!liveViewUrl) return { ok: false, code: "BROWSE_LIVE_VIEW_FAILED", reason: "Browser Run returned no Live View URL" };
        const handoffId = await withCdp(binding, sessionId, async (send) => {
          const sid = await attach(send);
          const r = (await send("Cloudflare.handoff", { instructions, timeout: HANDOFF_TIMEOUT_MS }, sid)) as { handoffId?: string };
          return String(r.handoffId ?? "");
        });
        return { ok: true, liveViewUrl, expiresInMs: LIVE_VIEW_MS, handoffId };
      } catch (err) {
        return fail("BROWSE_HANDOFF_FAILED", err);
      }
    },

    async handoffState(sessionId) {
      try {
        const active = await withCdp(binding, sessionId, async (send) => {
          const sid = await attach(send);
          const r = (await send("Cloudflare.getHandoffState", {}, sid)) as { active?: boolean };
          return r.active === true;
        });
        return { ok: true, active };
      } catch (err) {
        return fail("BROWSE_HANDOFF_FAILED", err);
      }
    },

    async close(sessionId) {
      await binding.closeSession(sessionId).catch(() => undefined);
    },
  };
}

/** Types a value into a field of the session's page; the one place a credential meets the browser. */
export async function injectField(binding: BrowserBinding, sessionId: string, selector: string, value: string): Promise<void> {
  await withCdp(binding, sessionId, async (send) => {
    const sid = await attach(send);
    const focus = `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'NOT_FOUND'; e.focus(); if ('value' in e) e.value = ''; return 'OK'; })()`;
    const r = (await send("Runtime.evaluate", { expression: focus, returnByValue: true }, sid)) as { result?: { value?: string } };
    if (r.result?.value !== "OK") throw new Error(`BROWSE_FIELD_NOT_FOUND: nothing on the page matches ${selector.slice(0, 80)}`);
    await send("Input.insertText", { text: value }, sid);
  });
}

/** Playwright's `storageState` shape (`vault/browser-state.ts`), as the binding reads and writes it over CDP. */
export interface SessionState {
  cookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None" }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

const READ_STORAGE = "JSON.stringify({ origin: location.origin, items: Object.keys(localStorage).map((k) => ({ name: k, value: localStorage.getItem(k) || '' })) })";

/** A session's login as Playwright's `storageState` would hold it: the browser's cookies and the page origin's localStorage. */
export async function captureState(binding: BrowserBinding, sessionId: string): Promise<SessionState> {
  return withCdp(binding, sessionId, async (send) => {
    const sid = await attach(send);
    const jar = (await send("Storage.getCookies")) as { cookies?: Array<Record<string, unknown>> };
    const cookies = (jar.cookies ?? []).map((c) => ({
      name: String(c.name ?? ""), value: String(c.value ?? ""), domain: String(c.domain ?? ""), path: String(c.path ?? "/"),
      expires: typeof c.expires === "number" ? c.expires : -1, httpOnly: c.httpOnly === true, secure: c.secure === true,
      sameSite: c.sameSite === "Strict" || c.sameSite === "None" ? (c.sameSite as "Strict" | "None") : ("Lax" as const),
    }));
    const r = (await send("Runtime.evaluate", { expression: READ_STORAGE, returnByValue: true }, sid)) as { result?: { value?: string } };
    const page = JSON.parse(String(r.result?.value ?? "null")) as { origin?: string; items?: Array<{ name: string; value: string }> } | null;
    return { cookies, origins: page?.origin && page.origin !== "null" ? [{ origin: page.origin, localStorage: page.items ?? [] }] : [] };
  });
}

/**
 * Puts a saved login into a fresh session before it navigates (M24.3): the cookies into the browser's
 * jar and each origin's localStorage through DOM storage, over the same CDP connection the live lane uses.
 */
export async function restoreState(binding: BrowserBinding, sessionId: string, state: SessionState): Promise<void> {
  await withCdp(binding, sessionId, async (send) => {
    const sid = await attach(send);
    const cookies = state.cookies.map(({ expires, ...c }) => (expires > 0 ? { ...c, expires } : c));
    if (cookies.length) await send("Storage.setCookies", { cookies });
    if (!state.origins.some((o) => o.localStorage.length)) return;
    await send("DOMStorage.enable", {}, sid);
    for (const o of state.origins) for (const item of o.localStorage) await send("DOMStorage.setDOMStorageItem", { storageId: { securityOrigin: o.origin, isLocalStorage: true }, key: item.name, value: item.value }, sid);
  });
}

/** The Worker's browser binding when this script has one; the generator adds it to tenant agent scripts only. */
export const browserOf = (env: unknown): BrowserBinding | undefined => (env as { BROWSER?: BrowserBinding }).BROWSER;
