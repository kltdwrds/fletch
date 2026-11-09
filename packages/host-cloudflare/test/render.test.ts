import { describe, expect, it } from "vitest";
import { containerRenderer, RENDERER_MISSING, singleAccountHost } from "../src/index.ts";

const DOC = { ok: true, to: "docx", base64: "UEsDBA==", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: 4 };

/** A RENDERER namespace whose one object answers `answer`; the names it was asked for and every input recorded. */
function renderer(answer: (op: "render" | "toMarkdown", input: unknown) => unknown) {
  const named: string[] = [];
  const asked: Array<[string, unknown]> = [];
  const ns = {
    idFromName: (n: string) => {
      named.push(n);
      return `id:${n}`;
    },
    get: () => ({
      render: async (input: unknown) => (asked.push(["render", input]), answer("render", input)),
      toMarkdown: async (input: unknown) => (asked.push(["toMarkdown", input]), answer("toMarkdown", input)),
    }),
  };
  return { ns, named, asked };
}

const env = (over: Record<string, unknown> = {}) =>
  ({ TENANT_ID: "solo-sam", OWNER_EMAIL: "sam@solo-sam.example", COMPANY: {} as DurableObjectNamespace, ...over }) as Parameters<typeof singleAccountHost>[0];

describe("[F56] the single-account host's renderer", () => {
  it("is refused by name where the deploy has no RENDERER binding, with the binding and the deploy that adds it in the reason", () => {
    const host = singleAccountHost(env());
    expect(host.render).toEqual({ ok: false, code: "HOST_RENDER_UNAVAILABLE", reason: RENDERER_MISSING });
    expect(RENDERER_MISSING).toContain("RENDERER");
    expect(RENDERER_MISSING).toContain("--render");
  });

  it("is the tenant's Renderer object where the deploy binds it, and passes a real document on", async () => {
    const r = renderer(() => DOC);
    const host = singleAccountHost(env({ RENDERER: r.ns }));
    expect("render" in host.render).toBe(true);
    const out = await (host.render as { render(i: unknown): Promise<unknown> }).render({ markdown: "# Hi", to: "docx" });
    expect(out).toEqual(DOC);
    expect(r.named).toEqual(["solo-sam:renderer"]);
    expect(r.asked).toEqual([["render", { markdown: "# Hi", to: "docx" }]]);
  });

  it("passes the object's own refusal on with its code and reason", async () => {
    const svc = containerRenderer(renderer(() => ({ ok: false, code: "RENDER_UNAVAILABLE", reason: "slow start" })).ns, "t") as { render(i: unknown): Promise<unknown> };
    expect(await svc.render({})).toEqual({ ok: false, code: "RENDER_UNAVAILABLE", reason: "slow start" });
  });

  it("catches a render that pretends: success without a document, an empty one or no outcome is RENDER_OUTPUT_INVALID", async () => {
    const pretenders: unknown[] = [{ ok: true }, { ...DOC, base64: "" }, { ...DOC, bytes: 0 }, { ...DOC, mediaType: undefined }, {}, null, "done", { ok: false }];
    for (const p of pretenders) {
      const svc = containerRenderer(renderer(() => p).ns, "t") as { render(i: unknown): Promise<unknown> };
      expect(await svc.render({ markdown: "x", to: "docx" }), JSON.stringify(p)).toMatchObject({ ok: false, code: "RENDER_OUTPUT_INVALID" });
    }
  });

  it("checks the reverse direction too: Markdown back, never an empty success", async () => {
    const good = { ok: true, to: "markdown", from: "docx", markdown: "# Hi", chars: 4 };
    const ok = containerRenderer(renderer(() => good).ns, "t") as { toMarkdown(i: unknown): Promise<unknown> };
    expect(await ok.toMarkdown({ from: "docx" })).toEqual(good);
    for (const p of [{ ok: true }, { ...good, markdown: undefined }, { ...good, chars: 99 }, null]) {
      const svc = containerRenderer(renderer(() => p).ns, "t") as { toMarkdown(i: unknown): Promise<unknown> };
      expect(await svc.toMarkdown({ from: "docx" }), JSON.stringify(p)).toMatchObject({ ok: false, code: "RENDER_OUTPUT_INVALID" });
    }
  });
});
