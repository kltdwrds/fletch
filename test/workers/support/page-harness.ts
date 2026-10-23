// The page harness of M18.1, shared from M19.1: the shipped page script run under a DOM just big enough
// for it, with its sockets scripted and its timers and ids in the test's hands. No sleeps: a timer fires
// only when the test fires it.
import { APP_PAGE } from "../../../packages/agent/src/http/page.ts";

/** The page's timers, run by the test: a cancelled one never fires. */
export function timers() {
  const list: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
  const live = () => list.filter((t) => !t.cancelled);
  return {
    live,
    schedule: (f: () => void, ms: number) => {
      const t = { f, ms };
      list.push(t);
      return t;
    },
    cancel: (t: { cancelled?: boolean } | undefined) => {
      if (t) t.cancelled = true;
    },
    fire(ms: number) {
      const t = live().find((x) => x.ms === ms);
      if (!t) throw new Error(`no live timer of ${ms} ms`);
      t.cancelled = true;
      t.f();
    },
  };
}

export interface ScriptedSocket {
  /** The address the page opened, so a test can tell which chat a socket is for. */
  url?: string;
  readyState: number;
  sent: string[];
  closed?: { code?: number; reason?: string };
  onopen?: () => void;
  onclose?: (e: { code: number; reason?: string }) => void;
  onmessage?: (e: { data: string }) => void;
  send(d: string): void;
  close(code?: number, reason?: string): void;
}

// A DOM just big enough for the page script: elements record text, class, children and handlers.
export class El {
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  /** The composer's placeholder, which says why it is closed (M23.2). */
  placeholder = "";
  className = "";
  /** The element's tag as the page created it; a `details` is closed until \`open\` is set. */
  tag = "";
  open = false;
  readonly dataset: Record<string, string> = {};
  /** The attributes the page set, by name: `aria-current` on tabs and chats, `open` on the panes (M23.1). */
  readonly attrs: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  onclick: (() => unknown) | null = null;
  onsubmit: ((e: unknown) => unknown) | null = null;
  oninput: (() => unknown) | null = null;
  onfocus: (() => unknown) | null = null;
  readonly id: string;
  /** Taken out of the page (M29.1): the document no longer finds it, or anything under it, by id. */
  detached = false;
  constructor(id = "") {
    this.id = id;
  }
  /** As the DOM's: anything that is not a node is appended as its text (M29.1: a null child reads "null"). */
  append(...c: unknown[]) {
    for (const n of c) {
      const x = n instanceof El ? n : Object.assign(new El(), { textContent: String(n) });
      x.parent?.children.splice(x.parent.children.indexOf(x), 1);
      x.parent = this;
      x.detached = false;
      this.children.push(x);
    }
  }
  /** The node after this one in its parent, or null (M29.1: a borrowed node remembers where it stood). */
  get nextSibling(): El | null {
    return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null;
  }
  /** Puts `x` before `ref`, a child of this element, as the DOM does; a null `ref` appends. */
  insertBefore(x: El, ref: El | null) {
    if (!ref) return this.append(x);
    if (ref.parent !== this) throw new Error("NotFoundError: the reference node is not a child of this node");
    x.parent?.children.splice(x.parent.children.indexOf(x), 1);
    x.parent = this;
    x.detached = false;
    this.children.splice(this.children.indexOf(ref), 0, x);
    return x;
  }
  replaceChildren() {
    for (const c of this.children) Object.assign(c, { parent: null, detached: true });
    this.children = [];
  }
  get parentNode(): El | null {
    return this.parent;
  }
  /** Puts `other` where this element stands (M20.1: a card drawn again replaces its earlier drawing). */
  replaceWith(other: El) {
    const at = this.parent;
    if (!at) return;
    other.parent?.children.splice(other.parent.children.indexOf(other), 1);
    at.children.splice(at.children.indexOf(this), 1, other);
    other.parent = at;
    other.detached = false;
    this.parent = null;
    this.detached = true;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.detached = true;
  }
  scrollIntoView() {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = String(value);
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  /** A copy of a static node the page clones (M26.2: the shell's glyphs); it has no id until one is set. */
  cloneNode() {
    return Object.assign(new El(), { tag: this.tag, copyOf: this.id });
  }
  /** The id of the node this one is a copy of (`cloneNode`), so a test can tell which glyph was copied. */
  copyOf = "";
  toggleAttribute(name: string, force?: boolean) {
    const on = force ?? !(name in this.attrs);
    if (on) this.attrs[name] = "";
    else delete this.attrs[name];
    if (name === "open") this.open = on;
    return on;
  }
  querySelector() {
    return new El();
  }
  /** Only the chat buttons the page draws into the drawer, which it marks with `aria-current`. */
  querySelectorAll(selector: string): El[] {
    return selector.includes("data-chat") ? this.children.filter((c) => c.dataset.chat) : [];
  }
  /** A bubble's streamed spans (`data-flow`, M27.3's word fade-in) are inline text, so they read as one run. */
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(this.dataset.flow ? "" : " ");
  }
}

/** The shell's overlay helper and device, as the shipped script defines them (M27.2). */
export interface Overlays {
  openDialog(node: El, o?: { form?: string; onClose?: () => void }): El;
  closeDialog(node: El): void;
  openMenu(anchor: El, items: Array<El | { label: string; glyph?: string; danger?: boolean; run: () => unknown }>): void;
  closeMenu(): void;
  confirmDialog(title: string, body: string, action: { label: string; danger?: boolean; run: () => unknown }): El;
  closeOverlays(): void;
  device(): "phone" | "tablet" | "desktop";
  /** The route switch every link calls: a view, or what was a page and is now an overlay (Settings panes, panel tabs). */
  show(view: string): void;
}

/** Runs the shipped page script with its timers and ids in the test's hands; the chat is the production engine. */
export async function page(
  chat: { onSend(data: string, socket: ScriptedSocket): void; fetch?: (path: string, init?: { method?: string; body?: string }) => Promise<Response | null> },
  layout: { desktop?: boolean; tablet?: boolean; dark?: boolean; pushEndpoint?: string | null; clipboard?: string[]; search?: string; path?: string } = {},
  /** Rewrites the shipped script before it runs, so a test can plant a violation on the production path (M29.1). */
  plant: (js: string) => string = (js) => js,
) {
  const els = new Map<string, El>();
  const byId = (id: string) => {
    const e = els.get(id) ?? new El(id);
    els.set(id, e);
    return e;
  };
  // The page's static elements as the markup nests them (M27.2: an overlay's node goes home to its parent when it
  // closes): each element with an id is a child of the nearest ancestor with one, and starts hidden when it says so.
  const body = APP_PAGE.slice(APP_PAGE.indexOf("<body"), APP_PAGE.indexOf("<script>"));
  const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "source", "wbr"]);
  const stack: Array<El | null> = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m as unknown as [string, string, string, string, string];
    if (close) {
      stack.pop();
      continue;
    }
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    let node: El | null = null;
    if (id) {
      node = byId(id);
      node.tag = tag.toLowerCase();
      node.hidden = /\shidden(\s|=|$)/.test(attrs);
      [...stack].reverse().find((x) => x)?.append(node);
    }
    if (!self && !VOID.has(tag.toLowerCase())) stack.push(node);
  }
  const t = timers();
  const sockets: ScriptedSocket[] = [];
  class PageSocket implements ScriptedSocket {
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    closed?: { code?: number; reason?: string };
    onopen?: () => void;
    onclose?: (e: { code: number; reason?: string }) => void;
    onmessage?: (e: { data: string }) => void;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    send(d: string) {
      this.sent.push(d);
      chat.onSend(d, this);
    }
    close(code?: number, reason?: string) {
      this.readyState = 3;
      this.closed = { code, reason };
    }
  }
  const answers: Record<string, unknown> = { "/app/chats": { main: "chat-ada", last: "chat-ada", chats: [{ id: "chat-ada", kind: "main", title: "Main", archived: false }] } };
  // The page's requests go to the test's `fetch` first (M20.1: decisions and the Approvals page), else the fixed answers.
  const fetch = async (path: string, init?: { method?: string; body?: string }) =>
    (await chat.fetch?.(path, init)) ?? new Response(JSON.stringify(answers[path] ?? { ok: false, code: "NOT_FOUND" }), { status: answers[path] ? 200 : 404 });
  let n = 0;
  const crypto = { randomUUID: () => `send-${++n}` };
  const js = plant(APP_PAGE.split("<script>")[1]?.split("</script>")[0] as string);
  // The page's keydown listeners (M27.2: Escape closes the top overlay), fired by the test's `key`.
  const keys: Array<(e: { key: string }) => void> = [];
  const document = {
    body: byId("body"),
    // As the DOM's: a node taken out of the page (or under one that was) is not found; any other id is.
    getElementById: (id: string) => {
      const e = byId(id);
      for (let x: El | null = e; x; x = x.parent) if (x.detached) return null;
      return e;
    },
    createElement: (tag: string) => Object.assign(new El(), { tag }),
    addEventListener: (type: string, f: (e: { key: string }) => void) => void (type === "keydown" && keys.push(f)),
  };
  // The address bar and the session history as a browser keeps them (F4): `path` (with any query and fragment) is the
  // address the page boots at, `search` a query on `/`. A push or a replace moves the address and sets the entry's
  // `state` (F5: an overlay's entry carries its marker); `back()` and `go(-n)` step to an earlier entry and fire the
  // page's `popstate` listeners, as a browser does, while a push or a replace fires none.
  const ORIGIN = "https://solo-sam.example";
  const at = new URL(layout.path ?? `/${layout.search ?? ""}`, ORIGIN);
  const location = { protocol: "https:", host: "solo-sam.example", pathname: at.pathname, search: at.search, hash: at.hash };
  const address = () => location.pathname + location.search + location.hash;
  const moveTo = (url: string) => {
    const u = new URL(url, ORIGIN + address());
    Object.assign(location, { pathname: u.pathname, search: u.search, hash: u.hash });
  };
  const popped: Array<() => void> = [];
  const entries = [address()];
  const states: unknown[] = [null];
  let index = 0;
  const history = {
    entries,
    states,
    get index() {
      return index;
    },
    get state() {
      return states[index] ?? null;
    },
    pushState(s: unknown, _t: string, url: string) {
      moveTo(url);
      entries.splice(index + 1, entries.length, address());
      states.splice(index + 1, states.length, s ?? null);
      index = entries.length - 1;
    },
    replaceState(s: unknown, _t: string, url: string) {
      moveTo(url);
      entries[index] = address();
      states[index] = s ?? null;
    },
    go(n: number) {
      const to = Math.max(0, Math.min(entries.length - 1, index + n));
      if (to === index) return;
      index = to;
      moveTo(entries[index] as string);
      for (const f of popped) f();
    },
    back() {
      history.go(-1);
    },
  };
  const window = { addEventListener: (type: string, f: () => void) => void (type === "popstate" && popped.push(f)) };
  // A desktop is the page's 1024 px query matching, a tablet its 768 px one (M27.2, the system's buckets), and `dark`
  // the scheme's; a phone matches none (the pane tests state which).
  const matches = (q: string) => (q.includes("1024") ? !!layout.desktop : q.includes("768") ? !!(layout.desktop || layout.tablet) : q.includes("dark") ? !!layout.dark : false);
  // A query answers for the layout as it is now, and `resize` (M26.4) changes the layout and tells every listener, as a
  // browser does when the window crosses a width.
  const changed: Array<() => void> = [];
  const matchMedia = (q: string) => ({
    get matches() {
      return matches(q);
    },
    addEventListener(_: string, f: () => void) {
      changed.push(f);
    },
  });
  // A browser holding a push subscription for `pushEndpoint` (M23.3: the Devices tab says whether this device is on).
  const held = { endpoint: layout.pushEndpoint ?? null, unsubscribed: 0 };
  const worker =
    layout.pushEndpoint === undefined
      ? {}
      : { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ pushManager: { getSubscription: async () => (held.endpoint ? { endpoint: held.endpoint, unsubscribe: async () => { held.endpoint = null; held.unsubscribed++; return true; } } : null) } }) } };
  // The Library's Share and Copy write to the clipboard (M23.4); a test that passes one reads what was copied.
  const navigator = { ...worker, ...(layout.clipboard ? { clipboard: { writeText: async (t: string) => void layout.clipboard?.push(t) } } : {}) };
  // The Goals and Feed tabs' draw functions come back to the test (M26.5): no store answers them yet, so a test hands the
  // shipped script a sample-shaped answer the way their engine parts will. The overlay helper and the device come
  // back too (M27.2), with the route switch, so a test drives the production helper every module uses.
  const draw = new Function("document", "fetch", "WebSocket", "location", "history", "window", "navigator", "URLSearchParams", "Intl", "Node", "setTimeout", "clearTimeout", "crypto", "matchMedia", `${js}\n;return { goalsDraw, goalsLoad, feedDraw, openDialog, closeDialog, openMenu, closeMenu, confirmDialog, closeOverlays, device, show };`)(
    document, fetch, PageSocket, location, history, window, navigator, URLSearchParams, Intl, El, t.schedule, t.cancel, crypto, matchMedia,
  );
  for (let i = 0; i < 50 && !sockets.length; i++) await new Promise((r) => setImmediate(r));
  const log = byId("log");
  return {
    draw: draw as { goalsDraw(answer: unknown): void; goalsLoad(read: () => Promise<unknown>): Promise<void>; feedDraw(days: unknown[]): void },
    ui: draw as unknown as Overlays,
    key: (k: string) => {
      for (const f of keys) f({ key: k });
    },
    t,
    held,
    /** The address bar, the session history (`back()` fires `popstate`) and the document, whose `title` the page sets. */
    location,
    history,
    document: document as typeof document & { title?: string },
    sockets,
    log,
    busy: () => !byId("busy").hidden,
    deliver: (s: ScriptedSocket, frame: unknown) => s.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) }),
    open: (s: ScriptedSocket) => {
      s.readyState = 1;
      s.onopen?.();
    },
    type: async (text: string) => {
      byId("t").value = text;
      await byId("f").onsubmit?.({ preventDefault() {} });
    },
    byId,
    bubbles: () => log.children.map((c) => [c.className, c.text()]),
    resize: (to: { desktop?: boolean; tablet?: boolean }) => {
      layout.desktop = to.desktop;
      layout.tablet = to.tablet;
      for (const f of changed) f();
    },
  };
}
