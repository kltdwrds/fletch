// M17.3: a first-look finding on the app page (QYVR-155; QYVR-154's skills table left the Library at M23.4). The shipped page script runs
// against a DOM just big enough for it and a routed fetch; the claims are about what the person reads.
import { describe, expect, it } from "vitest";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";

class El {
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  min = "";
  className = "";
  readonly dataset: Record<string, string> = {};
  readonly children: El[] = [];
  /** The delivery form's named fields. */
  zone = { value: "" };
  mail = { checked: false };
  onclick: (() => unknown) | null = null;
  onsubmit: ((e: unknown) => unknown) | null = null;
  onchange: (() => unknown) | null = null;
  readonly id: string;
  constructor(id = "") {
    this.id = id;
  }
  append(...c: El[]) {
    this.children.push(...c);
  }
  replaceChildren() {
    this.children.length = 0;
  }
  remove() {}
  scrollIntoView() {}
  setAttribute() {}
  removeAttribute() {}
  toggleAttribute() {}
  cloneNode() {
    return new El();
  }
  querySelector() {
    return new El();
  }
  querySelectorAll() {
    return [];
  }
  /** Each row of a table as its cells' text. */
  cells(): string[][] {
    return this.children.map((r) => r.children.map((c) => c.text()));
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(" ");
  }
}

class Quiet {
  readyState = 0;
  onopen = null;
  onclose = null;
  onmessage = null;
  send() {}
  close() {}
}

/** Runs the shipped page script; `answers` maps a path to its JSON. */
async function page(answers: Record<string, unknown>, clicks: string[]) {
  const els = new Map<string, El>();
  const byId = (id: string) => {
    const e = els.get(id) ?? new El(id);
    els.set(id, e);
    return e;
  };
  const fetch = async (path: string) => {
    const a = answers[path];
    return new Response(JSON.stringify(a ?? { ok: false, code: "NOT_FOUND" }), { status: a === undefined ? 404 : 200 });
  };
  const js = APP_PAGE.split("<script>")[1]?.split("</script>")[0] as string;
  const document = { getElementById: byId, createElement: () => new El() };
  new Function("document", "fetch", "WebSocket", "location", "navigator", "URLSearchParams", "Intl", "Node", js)(document, fetch, Quiet, { protocol: "https:", host: "x.example", search: "" }, {}, URLSearchParams, Intl, El);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  for (const id of clicks) {
    await byId(id).onclick?.();
    for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  }
  return byId;
}

/** Delivery is Settings' Messaging channels pane since M27.2: the rail's Settings menu, Settings, the pane. */
const TO_DELIVERY = ["to-settings", "settings-menu-open", "set-nav-messaging"];
const delivery = (stopped: string[]) => ({ zone: "UTC", mail: false, subscriptions: [], stopped });
const me = { person: "sam@solo-sam.example", role: "member", tenant: "solo-sam" };

describe("[M17.3] first-look polish", () => {
  it("QYVR-155: no stopped kinds shows a sentence, not a table of empty headers; stopped kinds show labelled columns", async () => {
    const empty = await page({ "/me": me, "/delivery": delivery([]), "/app/loops": { loops: [] } }, TO_DELIVERY);
    expect(empty("stopped-table").children).toEqual([]);
    expect(empty("stopped-note").textContent).toBe("Nothing stopped.");

    const some = await page({ "/me": me, "/delivery": delivery(["loop:reflection"]), "/app/loops": { loops: [] } }, TO_DELIVERY);
    // Since M27.6 the group's label names the kind of row and each stopped kind is a row with its action.
    expect(some("stopped-table").cells()).toEqual([["loop:reflection", "Allow again"]]);
    expect(some("stopped-note").textContent).toBe("");
  });
});
