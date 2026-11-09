// F56: the document renderer the deploy has. On the production path: `singleAccountHost` builds `render` from the
// deploy's RENDERER binding (here a fake namespace whose object is the real `Renderer` over a fake container whose
// port is a fake pandoc), the chat reaches it through `hostRender`, and `render_document` saves the document in the
// Library and tells the agent the markdown link the chat draws as a file card (B-P2-10). Without the binding the
// host refuses by name and the refusal reaches the person with its code and the binding it lacks. Ada of solo-sam.
import { describe, expect, it } from "vitest";
import { singleAccountHost } from "../../packages/host-cloudflare/src/index.ts";
import { homeKey } from "../../packages/agent/src/memory/home.ts";
import { Renderer } from "../../packages/agent/src/objects/renderer.ts";
import { NO_CONTAINER, RENDER_SLEEP_AFTER_MS, type RenderContainer } from "../../packages/agent/src/render/container.ts";
import { RENDER_ENTRYPOINT, RENDER_PORT } from "../../packages/agent/src/render/render.ts";
import { hostRender } from "../../packages/agent/src/render/tools.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";

const DOCX_BYTES = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
const DOCX = btoa(String.fromCharCode(...DOCX_BYTES));
const ABOUT = `# About me\n\nI am ${ada.name}'s agent.`;

/**
 * A container that runs a fake pandoc on its port: started once, every start, timeout and request recorded, in one
 * `events` order. `running` starts it as already up (an object restarted by a deploy); `fail` makes `start` throw.
 */
function fakeContainer(answer: (body: { to: string; text: string }) => Response = (b) => new Response(JSON.stringify({ output: b.to === "html" ? "<h1>About me</h1>" : DOCX })), opts: { running?: boolean; fail?: string } = {}) {
  const starts: unknown[] = [];
  const ports: number[] = [];
  const timeouts: number[] = [];
  const events: string[] = [];
  const asked: Array<{ to: string; text: string }> = [];
  const c: RenderContainer = {
    get running() {
      return !!opts.running || starts.length > 0;
    },
    start: (o) => {
      events.push("start");
      if (opts.fail) throw new Error(opts.fail);
      starts.push(o);
    },
    setInactivityTimeout: async (ms) => {
      events.push(`timeout:${ms}`);
      timeouts.push(ms);
    },
    getTcpPort: (port) => {
      ports.push(port);
      return {
        fetch: async (req: Request) => {
          const body = (await req.json()) as { to: string; text: string };
          asked.push(body);
          return answer(body);
        },
      };
    },
  };
  return { c, starts, ports, timeouts, events, asked };
}

/** The RENDERER namespace a paid deploy binds: each object is the real Renderer class over `container`. */
function rendererBinding(container: RenderContainer | undefined) {
  const named: string[] = [];
  const obj = new Renderer({ container } as never, {} as never);
  return { named, ns: { idFromName: (n: string) => (named.push(n), n), get: () => obj } };
}

const hostEnv = (over: Record<string, unknown> = {}) => ({ TENANT_ID: TENANT, OWNER_EMAIL: ada.email, COMPANY: {} as DurableObjectNamespace, ...over }) as Parameters<typeof singleAccountHost>[0];

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["documents"] } } };
const renderStep = (to: string): FakeStep => ({ toolCall: { id: "r1", name: "render_document", arguments: { markdown: ABOUT, to, name: "about-me" } } });
const REPLY = "Here it is: [about-me.docx](files/documents/about-me.docx)";

describe("[F56] the renderer the deploy has", () => {
  it("with the RENDERER binding, render_document renders on the Renderer's container into the Library and the reply links it as a file card", async () => {
    const box = fakeContainer();
    const bind = rendererBinding(box.c);
    const host = singleAccountHost(hostEnv({ RENDERER: bind.ns }));
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: REPLY }], render: hostRender(host) as never });
    await w.say(ada.email, "Make me an artifact: about you.");
    // pandoc started once in the container, with no internet, and asked on its own port.
    expect(box.starts).toEqual([{ entrypoint: RENDER_ENTRYPOINT, enableInternet: false }]);
    expect(box.ports).toEqual([RENDER_PORT]);
    // It stays up for RENDER_SLEEP_AFTER_MS after the request, set once the start has returned.
    expect(box.events).toEqual(["start", `timeout:${RENDER_SLEEP_AFTER_MS}`]);
    expect(box.asked).toMatchObject([{ text: ABOUT, to: "docx" }]);
    expect(bind.named).toEqual([`${TENANT}:renderer`]);
    // The bytes are in Ada's Library.
    expect([...(w.r2.bytes(homeKey(ada.email, "files/documents/about-me.docx")) ?? [])]).toEqual(DOCX_BYTES);
    const lib = await w.http(ada.email, "GET", "/app/library");
    expect((lib.body.files as { files: unknown[] }).files).toMatchObject([{ path: "documents/about-me.docx", size: DOCX_BYTES.length }]);
    // The tool told the agent the link the chat draws as a file card, and the stored reply is that markdown (B-P2-10).
    const said = w.transcriptOf(ada.email).join("\n");
    expect(said).toContain("Link it in your reply as [about-me.docx](files/documents/about-me.docx), which the chat shows as a file card.");
    expect(said).toContain(REPLY);
  });

  it("without the binding, render is refused by name: the person hears HOST_RENDER_UNAVAILABLE and the missing RENDERER, and nothing is saved", async () => {
    const host = singleAccountHost(hostEnv());
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: "I could not make it." }], render: hostRender(host) as never });
    const { chatId, result } = await w.say(ada.email, "Make me an artifact: about you.");
    // What the person sees: the turn's Activity drawer draws the render step failed, with the code and the missing binding.
    const opened = await w.http(ada.email, "GET", `/app/activity/${chatId}/${(result as { turnId: string }).turnId}`);
    const step = (opened.body.steps as Array<Record<string, unknown>>).find((s) => s.tool === "render_document");
    expect(JSON.stringify(step)).toContain('"code":"HOST_RENDER_UNAVAILABLE"');
    expect(JSON.stringify(step)).toContain("the RENDERER container binding is missing");
    const said = w.transcriptOf(ada.email).join("\n");
    expect(said).toContain("HOST_RENDER_UNAVAILABLE: the document was not made and nothing was saved: this deploy has no document renderer: the RENDERER container binding is missing");
    expect(said).not.toContain("SAVED:");
    expect(await w.host(ada.email).files.list({}, ada.email)).toEqual({ ok: true, files: [] });
  });

  it("a render that pretends is caught before the Library: success without a document is RENDER_OUTPUT_INVALID and nothing is saved", async () => {
    const liar = { idFromName: (n: string) => n, get: () => ({ render: async () => ({ ok: true, to: "docx" }), toMarkdown: async () => ({ ok: true }) }) };
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: "Said." }], render: hostRender(singleAccountHost(hostEnv({ RENDERER: liar }))) as never });
    await w.say(ada.email, "Make me an artifact: about you.");
    const said = w.transcriptOf(ada.email).join("\n");
    expect(said).toContain("RENDER_OUTPUT_INVALID");
    expect(said).not.toContain("SAVED:");
    expect(await w.host(ada.email).files.list({}, ada.email)).toEqual({ ok: true, files: [] });
  });

  it("a Renderer object with no container refuses with RENDER_UNAVAILABLE, never an empty document", async () => {
    const obj = new Renderer({} as never, {} as never);
    expect(await obj.render({ markdown: "# x", to: "docx" })).toEqual({ ok: false, code: "RENDER_UNAVAILABLE", reason: NO_CONTAINER });
    expect(await obj.toMarkdown({ from: "docx", to: "markdown", base64: DOCX })).toEqual({ ok: false, code: "RENDER_UNAVAILABLE", reason: NO_CONTAINER });
  });

  it("a running container is not started again", async () => {
    const box = fakeContainer();
    const obj = new Renderer({ container: box.c } as never, {} as never);
    await obj.render({ markdown: "# x", to: "html" });
    await obj.render({ markdown: "# y", to: "html" });
    expect(box.starts).toHaveLength(1);
    expect(box.asked.map((a) => a.text)).toEqual(["# x", "# y"]);
    expect(box.timeouts).toEqual([RENDER_SLEEP_AFTER_MS, RENDER_SLEEP_AFTER_MS]);
  });

  it("a container already running when the object starts is not started again, and its timeout is set in the constructor and on each render", async () => {
    const box = fakeContainer(undefined, { running: true });
    const held: Array<Promise<unknown>> = [];
    const ctx = {
      container: box.c,
      blockConcurrencyWhile: (f: () => Promise<unknown>) => {
        const p = f();
        held.push(p);
        return p;
      },
    };
    const obj = new Renderer(ctx as never, {} as never);
    await Promise.all(held);
    expect(held).toHaveLength(1);
    expect(box.timeouts).toEqual([RENDER_SLEEP_AFTER_MS]);
    await obj.render({ markdown: "# x", to: "html" });
    expect(box.starts).toEqual([]);
    expect(box.timeouts).toEqual([RENDER_SLEEP_AFTER_MS, RENDER_SLEEP_AFTER_MS]);
    expect(box.asked.map((a) => a.text)).toEqual(["# x"]);
  });

  it("a container that will not start is RENDER_UNAVAILABLE with its message in the reason: nothing thrown, pandoc never asked", async () => {
    const box = fakeContainer(undefined, { fail: "no container instance available" });
    const obj = new Renderer({ container: box.c } as never, {} as never);
    const reason = "the Renderer's container did not start: no container instance available";
    expect(await obj.render({ markdown: "# x", to: "docx" })).toEqual({ ok: false, code: "RENDER_UNAVAILABLE", reason });
    expect(await obj.toMarkdown({ from: "docx", to: "markdown", base64: DOCX })).toEqual({ ok: false, code: "RENDER_UNAVAILABLE", reason });
    expect(box.timeouts).toEqual([]);
    expect(box.ports).toEqual([]);
    expect(box.asked).toEqual([]);
  });
});
