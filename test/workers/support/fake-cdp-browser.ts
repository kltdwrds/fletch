// A scripted Browser Run binding at the CDP level (M24.3), so the production `browse/binding.ts` runs
// its own sockets and commands: `acquire` makes a fresh session with an empty cookie jar on a blank
// tab, `connectSession` hands back a socket whose every command is recorded with its session and
// answered from that session's state (cookies, each origin's localStorage, the page's address), and a
// navigation fires `Page.loadEventFired`. Fictional sites only; nothing reaches a network.
import type { BrowserBinding } from "../../../packages/agent/src/browse/binding.ts";

export interface CdpCall {
  session: string;
  method: string;
  params: Record<string, unknown>;
}

interface SessionState {
  cookies: Array<Record<string, unknown>>;
  storage: Map<string, Map<string, string>>;
  url: string;
}

type Listener = (event: { data: string }) => void;

export class FakeCdpBrowser {
  readonly calls: CdpCall[] = [];
  readonly sessions = new Map<string, SessionState>();
  private n = 0;

  /** The binding as `browse/binding.ts` types it. */
  get binding(): BrowserBinding {
    return {
      quickAction: async () => new Response("{}"),
      acquire: async () => {
        const sessionId = `cdp-${++this.n}`;
        this.sessions.set(sessionId, { cookies: [], storage: new Map(), url: "about:blank" });
        return { sessionId };
      },
      connectSession: async (sessionId) => ({ webSocket: { fetch: async () => ({ webSocket: this.socket(sessionId) }) } as unknown as Fetcher }),
      getSession: async (sessionId) => (this.sessions.has(sessionId) ? { sessionId } : null),
      closeSession: async () => ({}),
      getLiveView: async () => ({}),
      devtools: { listTargets: async () => [] },
    };
  }

  /** A session's state as a page in it would see it: what a person signing in there left behind. */
  seed(sessionId: string, at: string, cookies: Array<Record<string, unknown>>, storage: Record<string, string> = {}): void {
    const s = this.sessions.get(sessionId) as SessionState;
    s.url = at;
    s.cookies.push(...cookies);
    s.storage.set(new URL(at).origin, new Map(Object.entries(storage)));
  }

  /** The commands of one session in order, by method. */
  methods(sessionId: string): string[] {
    return this.calls.filter((c) => c.session === sessionId).map((c) => c.method);
  }

  private socket(sessionId: string) {
    const listeners: Listener[] = [];
    const s = this.sessions.get(sessionId) as SessionState;
    const emit = (m: unknown) =>
      queueMicrotask(() => {
        for (const l of listeners) l({ data: JSON.stringify(m) });
      });
    const answer = (method: string, params: Record<string, unknown>): Record<string, unknown> => {
      switch (method) {
        case "Target.getTargets":
          return { targetInfos: [{ targetId: "page-1", type: "page" }] };
        case "Target.attachToTarget":
          return { sessionId: "flat-1" };
        case "Storage.getCookies":
          return { cookies: s.cookies };
        case "Storage.setCookies":
          s.cookies.push(...(params.cookies as Array<Record<string, unknown>>));
          return {};
        case "DOMStorage.setDOMStorageItem": {
          const origin = String((params.storageId as { securityOrigin: string }).securityOrigin);
          const m = s.storage.get(origin) ?? new Map<string, string>();
          m.set(String(params.key), String(params.value));
          s.storage.set(origin, m);
          return {};
        }
        case "Page.navigate":
          s.url = String(params.url);
          emit({ method: "Page.loadEventFired", params: {} });
          return { frameId: "f1" };
        case "Runtime.evaluate": {
          const origin = s.url.startsWith("http") ? new URL(s.url).origin : "null";
          if (String(params.expression).includes("localStorage.getItem")) {
            const items = [...(s.storage.get(origin) ?? new Map()).entries()].map(([name, value]) => ({ name, value }));
            return { result: { value: JSON.stringify({ origin, items }) } };
          }
          const signedIn = s.cookies.some((c) => c.name === "session" && s.url.includes(String(c.domain).replace(/^\./, "")));
          return { result: { value: JSON.stringify({ status: 200, url: s.url, title: signedIn ? "Account" : "Sign in", text: signedIn ? "Welcome back." : "Please sign in.", links: [] }) } };
        }
        default:
          return {};
      }
    };
    return {
      accept: () => {},
      close: () => {},
      addEventListener: (type: string, l: Listener) => {
        if (type === "message") listeners.push(l);
      },
      send: (raw: string) => {
        const m = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
        this.calls.push({ session: sessionId, method: m.method, params: m.params });
        const result = answer(m.method, m.params);
        emit({ id: m.id, result });
      },
    };
  }
}
