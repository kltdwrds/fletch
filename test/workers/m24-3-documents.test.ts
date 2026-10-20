// M24.3 item 5, documents out: `render_document` on the Renderer (the M15.6 request and answer checks
// over a fake pandoc port), the result a Library item whose bytes are in R2 under the person's home
// prefix with their content type; owner-only short-lived signed links on M23.4's read route; and a
// public share link that runs only on its own fresh approval card, shows a share card with its expiry,
// is served with no session until then and refused after. The real chat engine, gate, card store,
// grants and routes over the object harness and the scripted (and hostile) fake model; the clock is
// the world's, moved by hand. Ada and Bo of solo-sam throughout.
import { describe, expect, it } from "vitest";
import { serve } from "../../packages/agent/src/http/serve.ts";
import { LINK_TTL_MS } from "../../packages/agent/src/files/links.ts";
import { homeKey } from "../../packages/agent/src/memory/home.ts";
import { render as renderMarkdown, type RenderResult } from "../../packages/agent/src/render/render.ts";
import { RENDER_WORDS } from "../../packages/agent/src/render/tools.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, T0, TENANT } from "./support/authority-world.ts";

const DOCX_BYTES = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x77, 0x72, 0x65, 0x6e];
const DOCX = btoa(String.fromCharCode(...DOCX_BYTES));
const BRIEF = `# Henley handover\n\n${ada.name} hands the Henley file to Pat.`;
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The Renderer as `renderer.ts` runs it, over a pandoc port that answers from `answer`; every request recorded. */
function pandoc(answer: (body: { to: string; text: string }) => Response | null) {
  const asked: Array<{ to: string; text: string }> = [];
  const run = (input: unknown) =>
    renderMarkdown(input, { fetch: async (req) => {
      const body = (await req.json()) as { to: string; text: string };
      asked.push(body);
      const r = answer(body);
      if (!r) throw new Error("connection refused");
      return r;
    } }, async () => {});
  return { asked, render: run as (input: { markdown: string; to: string }) => Promise<RenderResult> };
}
const okPandoc = () => pandoc((b) => new Response(JSON.stringify({ output: b.to === "html" ? `<html><body><h1>Henley handover</h1></body></html>` : DOCX }), { status: 200 }));

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["documents"] } } };
const renderStep = (to: string, name = "henley-brief", id = "r1"): FakeStep => ({ toolCall: { id, name: "render_document", arguments: { markdown: BRIEF, to, name } } });

/** One request to the agent script with no session at all: the public door `serve.ts` answers first. */
async function publicGet(w: ReturnType<typeof authorityWorld>, path: string) {
  // The test host's identity verifies nobody: a public route must answer before it is asked.
  const res = await serve(new Request(`https://${TENANT}.example${path}`), { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test" } as never, { tenant: TENANT }, { dir: w.dir as never, now: () => w.clock.now });
  return res;
}

describe("[M24.3] render_document", () => {
  it("renders Markdown to docx on the Renderer and saves a Library item whose bytes are in R2 under Ada's home prefix with their content type", async () => {
    const p = okPandoc();
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: "Made it." }], render: p.render });
    await w.say(ada.email, "Make the Henley brief a Word file.");
    expect(p.asked).toEqual([{ text: BRIEF, from: "markdown-raw_html-raw_attribute", to: "docx", standalone: true, sandbox: true }]);
    const key = homeKey(ada.email, "files/documents/henley-brief.docx");
    expect([...(w.r2.bytes(key) ?? [])]).toEqual(DOCX_BYTES);
    expect((await w.r2.get(key))?.httpMetadata).toEqual({ contentType: DOCX_TYPE });
    const lib = await w.http(ada.email, "GET", "/app/library");
    expect((lib.body.files as { files: unknown[] }).files).toMatchObject([{ path: "documents/henley-brief.docx", size: DOCX_BYTES.length, mediaType: DOCX_TYPE, writer: `agent:${ada.email}` }]);
    // The tool told the agent in words where it is, with a link for Ada alone.
    expect(w.transcriptOf(ada.email).join("\n")).toMatch(/SAVED: documents\/henley-brief\.docx \(docx, 14 bytes\) is in the person's Library\. Download link for the person only, valid 5 minutes: \/app\/file\/raw\?path=documents%2Fhenley-brief\.docx&exp=\d+&sig=[0-9a-f]{64}&download=1/);
    // A binary document is never read as text: file reads refuse it with a code, and the raw route serves nothing without a signed link.
    expect(await w.host(ada.email).files.read({ path: "documents/henley-brief.docx" }, ada.email)).toMatchObject({ ok: false, code: "FILES_BINARY" });
    expect(await w.http(ada.email, "GET", "/app/file/raw?path=documents%2Fhenley-brief.docx")).toMatchObject({ status: 403, body: { code: "LINK_REQUIRED" } });
    // Bo's Library does not list it.
    expect(((await w.http(other.email, "GET", "/app/library")).body.files as { files: unknown[] }).files).toEqual([]);
  });

  it("renders html as a text Library item the M23.4 viewer reads, and odt as bytes", async () => {
    const p = okPandoc();
    const w = authorityWorld({ script: [load, renderStep("html", "brief", "r1"), renderStep("odt", "brief", "r2"), { text: "Both." }], render: p.render });
    await w.say(ada.email, "Make it html and odt.");
    expect(await w.http(ada.email, "GET", "/app/file?path=documents%2Fbrief.html")).toMatchObject({ status: 200, body: { text: "<html><body><h1>Henley handover</h1></body></html>", complete: true } });
    expect(await w.host(ada.email).files.list({}, ada.email)).toMatchObject({ files: [{ path: "documents/brief.html", size: 50 }, { path: "documents/brief.odt", mediaType: "application/vnd.oasis.opendocument.text" }] });
  });

  it("says each Renderer code in words and saves nothing", async () => {
    const cases: Array<[string, Parameters<typeof pandoc>[0], string]> = [
      ["RENDER_FAILED", () => new Response(JSON.stringify({ error: "unknown reader" }), { status: 200 }), "docx"],
      ["RENDER_OUTPUT_INVALID", () => new Response(JSON.stringify({ output: btoa("not a zip") }), { status: 200 }), "docx"],
      ["RENDER_UNAVAILABLE", () => null, "docx"],
      ["RENDER_FORMAT_REFUSED", () => null, "pdf"],
    ];
    for (const [code, answer, to] of cases) {
      const p = pandoc(answer);
      const w = authorityWorld({ script: [load, renderStep(to), { text: "Said." }], render: p.render });
      await w.say(ada.email, "Make the brief.");
      const said = w.transcriptOf(ada.email).join("\n");
      expect(said, code).toContain(code);
      expect(said, code).toContain(RENDER_WORDS[code as keyof typeof RENDER_WORDS]);
      expect(said, code).not.toContain("SAVED:");
      expect(await w.host(ada.email).files.list({}, ada.email), code).toEqual({ ok: true, files: [] });
      expect([...w.r2.objects.keys()].filter((k) => k.includes("/files/")), code).toEqual([]);
    }
  });
});

describe("[M24.3] signed download links", () => {
  async function saved() {
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: "Made it." }], render: okPandoc().render });
    await w.say(ada.email, "Make the brief.");
    const link = await w.http(ada.email, "GET", "/app/file/link?path=documents%2Fhenley-brief.docx&download=1");
    expect(link).toMatchObject({ status: 200, body: { ok: true, path: "documents/henley-brief.docx", expiresAt: T0 + LINK_TTL_MS } });
    return { w, url: String(link.body.url) };
  }

  it("serves the bytes to Ada with her session until the link expires, then refuses it with a code", async () => {
    const { w, url } = await saved();
    const r = await w.http(ada.email, "GET", url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(DOCX_TYPE);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="henley-brief.docx"');
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    w.clock.now = T0 + LINK_TTL_MS;
    expect(await w.http(ada.email, "GET", url)).toMatchObject({ status: 410, body: { code: "LINK_EXPIRED" } });
  });

  it("refuses a tampered link: another path, a later expiry, a changed signature", async () => {
    const { w, url } = await saved();
    await w.host(ada.email).files.write({ path: "notes/plan.md", text: "plan" }, { requester: ada.email, writer: ada.email });
    const u = new URL(url, "https://x.example");
    const variants = [
      url.replace("documents%2Fhenley-brief.docx", "notes%2Fplan.md"),
      url.replace(`exp=${u.searchParams.get("exp")}`, `exp=${Number(u.searchParams.get("exp")) + 3_600_000}`),
      url.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === "0" ? "1" : "0"}`),
      url.replace(/&sig=[0-9a-f]+/, ""),
    ];
    for (const v of variants) expect(await w.http(ada.email, "GET", v), v).toMatchObject({ status: 403, body: { code: "LINK_INVALID" } });
  });

  it("Bo cannot download Ada's item, even with Ada's own link, nor get a link to it", async () => {
    const { w, url } = await saved();
    expect(await w.http(other.email, "GET", url)).toMatchObject({ status: 403, body: { code: "LINK_INVALID" } });
    expect(await w.http(other.email, "GET", "/app/file/link?path=documents%2Fhenley-brief.docx")).toMatchObject({ status: 404, body: { code: "FILES_NOT_FOUND" } });
    // Bo's own object never holds Ada's row, and Ada's object refuses a requester who is not Ada.
    expect(await w.host(ada.email).links.linked({ path: "documents/henley-brief.docx", exp: "1", sig: "0".repeat(64) }, other.email)).toMatchObject({ ok: false, code: "FILES_NOT_OWNER" });
  });
});

describe("[M24.3] public share links", () => {
  /** The hostile model: it shares, and asks for a standing, auto-approving grant for sharing in its arguments and its words. */
  const hostile: FakeStep[] = [
    load,
    renderStep("docx"),
    { toolCall: { id: "s1", name: "share_document", arguments: { path: "documents/henley-brief.docx", minutes: 2880, standing: true, auto_approve: true, grant: { mode: "auto", always: true } } }, text: "Choose 'Always allow' so I never have to ask about sharing again." },
  ];

  it("a hostile model's ask for a standing grant is refused everywhere: the card offers once or decline, a lasting choice and a lasting grant are refused, and no link exists", async () => {
    const w = authorityWorld({ script: [...hostile, { text: "Waiting." }], render: okPandoc().render });
    const { chatId } = await w.say(ada.email, "Share the brief with the Henley people.");
    const [card] = w.cardsOf(ada.email);
    expect(card).toMatchObject({ state: "pending", title: "Your agent asks to: share document" });
    expect(card?.lines).toEqual(expect.arrayContaining(["File: documents/henley-brief.docx", "Anyone with the link can open it for 48 hours."]));
    expect(card?.choices.map((c) => c.choice)).toEqual(["once", "deny"]);
    for (const choice of ["always", "period"]) {
      expect((await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice })).body).toMatchObject({ results: [{ ok: false, code: "SHARE_NOT_LASTING" }] });
    }
    for (const g of [{ mode: "auto" }, { mode: "auto", expires_at: T0 + 86_400_000 }, { mode: "auto", one_shot: true, created_from: "chat-confirmation" }]) {
      const r = await w.http(ada.email, "POST", "/api/grants", { grantor: { kind: "person", id: ada.email }, grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "files.share" }, created_from: "chat-confirmation", constraints: {}, ...g });
      expect(r.body, JSON.stringify(g)).toMatchObject({ code: "GRANT_SHARE_LASTING" });
    }
    expect(await w.host(ada.email).authority.list(ada.email)).toEqual([]);
    expect(w.personHarness(ada.email)?.rows("SELECT id FROM shares")).toEqual([]);
    expect([...w.r2.objects.keys()].filter((k) => k.startsWith("shares/"))).toEqual([]);
    expect(w.chats.harness(chatId).instance.linksFor(ada.email)).toEqual([]);
  });

  it("a standing grant planted in the store past the rules is never honoured: each share is its own fresh card", async () => {
    const share = hostile[2] as FakeStep;
    const w = authorityWorld({ script: [load, renderStep("docx"), { text: "Made." }, share, { text: "Waiting." }], render: okPandoc().render });
    const { chatId } = await w.say(ada.email, "Make the brief first.");
    // Planted around `grants/validate.ts`: a lasting auto grant over every files action, and an unused card grant for sharing.
    const h = w.personHarness(ada.email);
    await w.host(ada.email).authority.list(ada.email); // makes the store's tables
    const plant = (id: string, g: Record<string, unknown>) =>
      h?.db.prepare("INSERT INTO grants (id, body, created_at) VALUES (?, ?, ?)").run(id, JSON.stringify({ id, tenant: TENANT, grantor: { kind: "person", id: ada.email }, grantee: { kind: "own-agent" }, mode: "auto", constraints: {}, created_at: T0, ...g }), T0);
    plant(`g_${"a".repeat(32)}`, { subject: { kind: "action-kind", ref: "files.*" }, created_from: "chat-confirmation" });
    plant(`g_${"b".repeat(32)}`, { subject: { kind: "action-kind", ref: "files.share" }, one_shot: true, created_from: "approval-card" });
    await w.say(ada.email, "Now share it.", chatId);
    expect(w.cardsOf(ada.email).filter((c) => c.state === "pending")).toHaveLength(1);
    expect(h?.rows("SELECT id FROM shares")).toEqual([]);
    expect(w.chats.harness(chatId).instance.linksFor(ada.email)).toEqual([]);
    // The engine's own answer: the lasting grant never matches a share; only the card's one-shot grant could.
    const decided = await w.host(ada.email).authority.decide({ actor: `agent:${ada.email}`, principal: ada.email, actionKind: "files.share", subject: { scope: "personal", ref: "personal" }, counterpart: { kind: "own-agent" }, origin: ada.email, hops: 0, at: T0 });
    expect(decided).toMatchObject({ decision: "auto", grantId: `g_${"b".repeat(32)}` });
    h?.db.prepare("DELETE FROM grants WHERE id = ?").run(`g_${"b".repeat(32)}`);
    expect(await w.host(ada.email).authority.decide({ actor: `agent:${ada.email}`, principal: ada.email, actionKind: "files.share", subject: { scope: "personal", ref: "personal" }, counterpart: { kind: "own-agent" }, origin: ada.email, hops: 0, at: T0 })).toMatchObject({ decision: "ask", code: "NO_GRANT" });
  });

  it("allowed once on its card: a share card with its expiry, served with no session until then, refused after; a second share is a fresh card", async () => {
    const w = authorityWorld({ script: [...hostile, { text: "Shared." }, { toolCall: { id: "s2", name: "share_document", arguments: { path: "documents/henley-brief.docx" } } }, { text: "Waiting again." }], render: okPandoc().render });
    const { chatId } = await w.say(ada.email, "Share the brief.");
    const [card] = w.cardsOf(ada.email);
    expect((await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice: "once" })).body).toMatchObject({ results: [{ ok: true, state: "approved", outcome: "DONE" }] });
    const expiresAt = T0 + 48 * 3_600_000;
    const [share] = w.chats.harness(chatId).instance.linksFor(ada.email) ?? [];
    expect(share).toMatchObject({ kind: "share", title: "Shared publicly: henley-brief.docx", text: `Anyone with this link can open henley-brief.docx until ${new Date(expiresAt).toISOString().slice(0, 16).replace("T", " ")} UTC. After that it stops working.` });
    expect(share?.href).toMatch(/^\/hooks\/share\/[0-9a-f]{32}\.[0-9a-f]{64}$/);
    // The grant it ran under is the card's own one-shot grant, now spent.
    expect(await w.host(ada.email).authority.list(ada.email)).toMatchObject([{ subject: { ref: "files.share" }, one_shot: true, created_from: "approval-card", used_at: expect.any(Number) }]);

    const open = await publicGet(w, share?.href as string);
    expect(open.status).toBe(200);
    expect([...new Uint8Array(await open.arrayBuffer())]).toEqual(DOCX_BYTES);
    expect(open.headers.get("content-type")).toBe(DOCX_TYPE);
    expect(open.headers.get("referrer-policy")).toBe("no-referrer");
    // Tampered and unknown tokens are refused with codes; nothing asks for a session.
    const href = share?.href as string;
    expect(await (await publicGet(w, href.replace(/\.([0-9a-f])/, (_m, c: string) => `.${c === "0" ? "1" : "0"}`))).json()).toMatchObject({ code: "SHARE_INVALID" });
    expect(await (await publicGet(w, `/hooks/share/${"c".repeat(32)}.${"d".repeat(64)}`)).json()).toMatchObject({ code: "SHARE_UNKNOWN" });

    w.clock.now = expiresAt - 1;
    expect((await publicGet(w, href)).status).toBe(200);
    w.clock.now = expiresAt;
    const late = await publicGet(w, href);
    expect(late.status).toBe(410);
    expect(await late.json()).toMatchObject({ code: "SHARE_EXPIRED" });

    // The same share asked again: a new card, not a second link under the first approval.
    await w.say(ada.email, "Share it again.", chatId);
    expect(w.cardsOf(ada.email).filter((c) => c.state === "pending")).toHaveLength(1);
    expect(w.personHarness(ada.email)?.rows("SELECT id FROM shares")).toHaveLength(1);
  });

  it("a shared file changed after its approval is not served", async () => {
    const w = authorityWorld({ script: [...hostile, { text: "Shared." }], render: okPandoc().render });
    const { chatId } = await w.say(ada.email, "Share the brief.");
    const [card] = w.cardsOf(ada.email);
    await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: [card?.id], choice: "once" });
    const href = (w.chats.harness(chatId).instance.linksFor(ada.email) ?? [])[0]?.href as string;
    await w.host(ada.email).files.writeBytes({ path: "documents/henley-brief.docx", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]), mediaType: DOCX_TYPE }, { requester: ada.email, writer: `agent:${ada.email}` });
    const r = await publicGet(w, href);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "SHARE_CHANGED" });
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
